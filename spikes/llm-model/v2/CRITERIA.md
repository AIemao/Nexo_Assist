# Spike do ADR-009, V2: protocolo e limites de aprovação

**Estado: V2.1 CONGELADA em 2026-11-13**, antes de qualquer rodada oficial. A V2 original (congelada em 2026-11-12) fica reproduzível pelo commit `e0469db`; a diferença está na seção "V2.1". Os SHA-256 da seção "Arquivos" conferem o congelamento; a CLI da V2 e o `identity.test.ts` os verificam. Mudar o protocolo, o prompt, as tools, as fixtures ou os casos depois do congelamento invalida a comparação.

## V2.1 (2026-11-13): retry interno do Mastra × verificação de truncamento

**Motivo.** Na V2 (`e0469db`), a verificação de truncamento contava **todos** os passos do turno. Um passo `retry`, que é a nova tentativa interna do Mastra depois de um erro do provider (HTTP 500 ou 429), não tem inferência nem `usage`, e fica com `inputTokens` null. Por isso um **único** 500 transitório, mesmo recuperado, marcava o turno como não verificado (`UNKNOWN`). Pela regra dos 18 em `NOT_DETECTED`, isso deixava o requisito de truncamento inconclusivo para o candidato inteiro. A medição está no commit `dbe9a82` (`mastra-behavior.test.ts`).

**Regra nova (`contextCheckFromCalls`, em `v2/src/run.ts`):**

- Só passos **com inferência** contam. Passos com `finishReason` `retry` ou `error` ficam fora da verificação de completude **e** do cálculo do maior `inputTokens` reportado.
- Passo de inferência (`tool-calls`, `stop` etc.) com `inputTokens` null: `UNKNOWN`.
- Nenhum passo de inferência com `usage` observável (inclusive sem passo de inferência): `UNKNOWN`.
- Nenhum token ausente é imputado, e nenhum valor é copiado de outro passo.
- As regras de `DETECTED` (acima de 7680), do orçamento e da suspeita de corte silencioso (abaixo de metade da estimativa local) não mudam (`contextCheckOf`).

**Diferença em relação à V2:** só o conjunto de passos que entra na verificação. Sem passos `retry` ou `error`, o resultado é idêntico ao da V2, o que o teste (f) confere.

**Evidências** (`v2/src/context-check.test.ts`, sem modelo real):

| Teste | Cenário | Resultado V2.1 |
| --- | --- | --- |
| (a) | 500 → retry (null) → tool de negócio com usage → submissão aceita com usage, pelo caminho real do Ollama com HTTP fabricado | `NOT_DETECTED` (a regra da V2 dava `UNKNOWN`) |
| (b) | retry (null) seguido de passo de inferência com null | `UNKNOWN` |
| (c) | nenhum passo de inferência com usage (sem passos; só retry/error; inferência só com null) | `UNKNOWN` |
| (d) | retry sem usage e passo de inferência acima do orçamento | `DETECTED`; retry fora do maior valor |
| (e) | passo 1 com usage, passo 2 `error` (turno `EXEC_*`), em função pura e caminho real | `NOT_DETECTED` nesse turno |
| (f) | sem retry/error | idêntico à V2 |
| (g) | suspeita de corte silencioso, com e sem retry; limite exato; `DETECTED` prevalece | regras inalteradas |
| (h) | identidade (`identity.test.ts`, "manifesto da V2.1"): tabelas de manifesto no formato do `verifyManifest` | exatamente uma, a da V2.1, com 29 arquivos distintos, todos os hashes iguais |

O `mastra-behavior.test.ts` (fora do manifesto) passa a afirmar `NOT_DETECTED` no cenário medido, com o comentário de que a V2 (`e0469db`) dava `UNKNOWN`. O `identity.test.ts` passa a exigir uma única tabela ativa de manifesto, a da V2.1, com 29 arquivos.

**O que não muda:** protocolo, prompt, tools, schema, invariantes, pontuação, limites, `REASONING_CONTROL` e a V1. O `aggregate` da V1 é reutilizado sem mudança.

## Relação com a V1

- A V1 (`spikes/llm-model/`, commit `2182d6b`) fica **intacta**: arquivos, critérios e resultados. A V2 é um **experimento independente**, com manifesto, critérios, testes e commit de congelamento próprios.
- **O que muda:** a interpretação deixa de vir da saída estruturada nativa do provider e passa a ser entregue por uma **tool terminal de protocolo**, `submitInterpretation` (D2). Nada mais muda no comportamento pedido ao modelo.
- **O que fica idêntico à V1:** as quatro tools de negócio, o schema da interpretação, as fixtures, os seis casos e os gabaritos, os modelos, a configuração (temperatura, seed, limites, controle de raciocínio, aquecimento, novas tentativas, `maxSteps`, tempo limite), as regras de pontuação dos gabaritos e o denominador de 18. Os arquivos compartilhados são **importados da V1 sem cópia** e entram no manifesto da V2 com o mesmo SHA-256 da V1 (seção "Reutilização da V1").
- **Comparação V1 × V2:** descritiva, métrica a métrica, sobre as mesmas entradas e gabaritos. A V2 tem aprovação própria; o resultado da V1 não entra no da V2.

## Não é baseline

Igual à V1: **ainda não existe baseline oficial.** Este spike seleciona modelo para o ADR-009; a primeira execução da avaliação completa (`docs/evaluation/01-evaluation-scenarios.md`), depois da decisão do ADR-009, será o baseline (README §10).

## Desenho (D2)

- **Tools disponíveis ao modelo:** as quatro tools de negócio da V1 (`searchArticles`, `listMyTickets`, `proposeTicketDraft`, `requestHandoff`), importadas de `../src/tools.ts` sem alteração, e `submitInterpretation`.
- **`submitInterpretation`:** tool de protocolo. Entrada: `interpretationSchema` (`../src/schema.ts`, DM §3.12), o mesmo schema estrito da V1. Saída para o modelo: só um status. Não tem efeito de negócio, não é resposta ao funcionário e não conta na métrica de tool de negócio.
- **Sem saída estruturada nativa:** o `agent.generate` não recebe `structuredOutput`. Não há `response_format` (Ollama) nem tool sintética `json` (Groq).
- **`toolChoice: "auto"`**, passado explicitamente, para os três modelos. Nunca `required`.
- **Texto ao funcionário: fora do escopo.** O texto produzido junto com qualquer chamada não é resposta final nem é avaliado. Continua passando pela checagem de vazamento de raciocínio (seção "Segurança").

## Requisitos eliminatórios (E1 a E4)

E1 (custo zero), E3 (termos para dados fictícios) e E4 (cota diária para uma avaliação completa) **iguais à V1**, com a mesma conclusão: o Groq não atende ao E4 com os limites lidos em 2026-11-09 e segue **só como referência**.

**E2 na V2:** o modelo roda no agent Mastra e, no mesmo turno, chama as tools de negócio e entrega a interpretação pela `submitInterpretation`, com `toolChoice: "auto"`. Verificado em execução; as sondagens (seção "Sondagens") só informam.

## Modelos

Iguais à V1:

| Papel | Caminho | Modelo | Aprovação |
| --- | --- | --- | --- |
| Principal | Ollama, endpoint compatível com OpenAI pelo model router do Mastra (`../src/models.ts`) | `qwen3:4b-instruct` | Candidato |
| Comparação | Ollama, mesmo caminho | `qwen3:8b` | Candidato |
| Referência | Groq (`@ai-sdk/groq`) | `openai/gpt-oss-120b` | Referência, fora da aprovação (E4) |

**Digest de cada imagem Ollama:** a CLI o lê de `/api/tags` do mesmo servidor, antes da rodada e fora do monitor de requisições do turno, e o grava no cabeçalho da execução (`modelDigest`). Se o modelo não aparece na lista, o valor fica `null`, e o resumo o marca como não encontrado. No Groq, `null` (N/A).

## Configuração

Idêntica à V1 (`../src/run.ts`):

- 3 repetições por caso, em sessões independentes (agent novo, tools novas, sem memória).
- Temperatura 0, seed 42, saída máxima 512, `maxRetries: 0` no Mastra (`MODEL_SETTINGS`, importado da V1).
- Entrada máxima 7680 tokens; contexto do servidor Ollama em 8192, conferido no `ollama ps`.
- Controle de raciocínio por provider: `REASONING_CONTROL`, importado da V1, sem mudança (Ollama `reasoning_effort: "none"`; Groq `reasoning_format: "hidden"`).
- Aquecimento: um turno fora do denominador, com o mesmo formato da V1 (`"Olá."`, sem histórico).
- Novas tentativas: até 3 por turno, respeitando o `Retry-After`; cota diária esgotada para a execução.
- `maxSteps: 5` e tempo limite de 180 s por turno. Os dois valores e o número de tentativas não são exportados pela V1; a V2 os repete, e um teste confere que são iguais aos do código da V1. **Sem mudança:** o caso mais longo esperado é tool de negócio → submissão (2 passos), e uma correção depois de submissão recusada acrescenta 1.
- Prompt idêntico para os três modelos, sem ajuste por modelo.

## Prompt da V2

`v2/src/prompt.ts` difere do prompt da V1 (`../src/prompt.ts`) **só** no necessário para a `submitInterpretation`. As correções de instrução já identificadas (`missingFields`, origem do impacto) ficam fora da V2.

| Linha da V1 | V2 |
| --- | --- |
| L12 `PROMPT_VERSION = "spike-adr009-prompt-v1"` | `"spike-adr009-prompt-v2"` |
| L14–L29 | Idênticas. A L19 ("Nenhuma delas cria ou altera chamados") continua verdadeira com a `submitInterpretation` |
| L30 `Interpretação de cada turno:` | `Interpretação de cada turno: entregue-a chamando a ferramenta submitInterpretation exatamente uma vez, sozinha (sem outra ferramenta na mesma resposta) e por último, depois de receber os resultados das outras ferramentas.` |
| L31–L50 | Idênticas |

**Descrição da `submitInterpretation`** (faz parte do instrumento congelado): `Entrega ao sistema a interpretação estruturada do turno. Chame exatamente uma vez, sozinha e por último. Não é a resposta ao funcionário.`

Um teste confere que o prompt da V2 é o da V1 com exatamente essas duas linhas trocadas.

## Unidade de medida

- **Resultado = um turno completo do agent**, da entrada do funcionário até o fim do ciclo (submissão aceita, violação de passo, resposta sem submissão ou `maxSteps`).
- **Denominador fixo: 18 por modelo** (6 casos × 3 repetições). Nenhum resultado é descartado.
- Latência do turno e, por chamada interna, tokens e latência.

## Protocolo da submitInterpretation

### Caminho de execução no Mastra 1.81.0 instalado

- O `Agent.generate` chama o método `doGenerate` do modelo (`agent-DtdQ6un6.js:32216`: `methodType === "stream" ? model.doStream : model.doGenerate`). Isso vale para os dois caminhos reais: o model router (Ollama, `openai-compatible`) e o `@ai-sdk/groq` (especificação v4).
- Os adaptadores do Mastra (`AISDKV5LanguageModel`, `AISDKV7LanguageModel` e o do router) recebem a resposta **completa** do `doGenerate` e só então sintetizam um stream (`createStreamFromGenerateResult`). Por isso todos os chunks `tool-call` de um passo existem antes de o loop passar à execução das tools (`map-tool-calls` → `foreach`).
- **O `Agent.stream()` é diferente e a V2 não o usa.** Nele, a execução antecipada vem ligada por padrão (`eagerToolExecution ?? true`, `agent-DtdQ6un6.js:62863`): cada tool começa assim que o chunk dela chega, antes do fim do passo. O `Agent.generate` não suporta essa opção; nele, a tool espera o passo inteiro (`agent/agent.types.d.ts:526-532`).
- Conferido nos testes sem modelo real:
  - pelos caminhos reais do Ollama e do Groq, com respostas HTTP fabricadas (a requisição não tem `stream: true`);
  - pelo `doStream` do dublê, com atraso entre os chunks `tool-call`, sem execução antecipada (o mesmo agendamento do `generate`): a premissa vale;
  - com a execução antecipada do `stream`: a premissa **quebra** (a tool de negócio executa antes de a submissão chegar), e a I5 e a I2 detectam. Isso prova a rede de segurança.

### Termos

- **Emitida:** chamada que o modelo produziu, registrada com passo, `toolCallId`, nome e **argumentos crus**.
- **Argumentos crus:** o JSON que o modelo emitiu, só decodificado, copiado no chunk `tool-call` **antes** da validação e das coerções do Mastra.
- **Aceita:** a `submitInterpretation` foi **executada** pelo Mastra: passou na validação do Mastra e na guarda de passo.
- **Passo violado:** passo com `submitInterpretation` acompanhada de outra chamada, ou com mais de uma `submitInterpretation`.
- **Interpretação avaliada:** os argumentos crus da **primeira** `submitInterpretation` emitida no turno, desde que o passo dela não seja violado. Intenção, entidades e Zod são avaliados **só** nela; uma correção posterior é registrada e analisada, mas não é pontuada.

### Guarda de passo

- **Decisão pela composição completa do passo.** A guarda acumula os chunks `tool-call` do passo e decide no primeiro `beforeToolCall` desse passo. Essa primeira decisão **sela** a composição.
- **Mesma decisão para todo o passo.** A decisão depende só da composição selada, então todas as chamadas do passo, executadas em paralelo (até 10 por padrão), recebem a mesma decisão.
- **Recusa.** Uma chamada recusada pela guarda não executa: o hook devolve `{ proceed: false }` com um resultado de erro.

| Composição do passo | Decisão | Código |
| --- | --- | --- |
| Uma `submitInterpretation`, sozinha | Segue para a validação do Mastra; se executada, é **aceita** | — |
| `submitInterpretation` + tool de negócio | **Nenhuma chamada do passo produz efeito**: a guarda recusa todas antes de executar, inclusive a submissão | `SEM_PROTOCOL_SAME_STEP` |
| `submitInterpretation` + nome de tool desconhecido | **Nenhuma chamada do passo produz efeito e a submissão é bloqueada pela guarda.** O nome desconhecido não passa pelos hooks: o Mastra devolve erro de tool inexistente | `SEM_PROTOCOL_SAME_STEP` |
| Duas ou mais `submitInterpretation` | **Todas** recusadas; nenhuma aceita | `SEM_PROTOCOL_MULTIPLE` |
| Só tools de negócio | Executam normalmente | — |
| Só nome desconhecido | O Mastra devolve erro de tool inexistente e o ciclo segue | (`SEM_WRONG_TOOL` na métrica de tool) |

**Premissa de ordem.** A guarda supõe que todos os chunks `tool-call` de um passo chegam antes da primeira execução daquele passo. O caminho de execução acima garante isso no Mastra 1.81.0 instalado. **Se a premissa falhar com provider real** (chunk `tool-call` depois do selo), a guarda recusa a chamada atrasada e registra a quebra (I5). A **I2 é a rede de segurança**: se uma tool de negócio tiver executado num passo que, com a composição completa, é violado, a rodada é invalidada como defeito do instrumento.

### Terminalidade

- **Quando o `stopWhen` encerra:** retorna `true` quando há **submissão aceita** ou **passo violado**. No Mastra 1.81.0, ele é avaliado depois das execuções do passo e antes da próxima geração; por isso é a guarda, e não o `stopWhen`, que impede os efeitos no passo violado.
- **O `stopWhen` não anula o `maxSteps`:** o teto do `maxSteps` continua valendo quando o `stopWhen` retorna `false` (teste 8).
- **Submissão recusada pela validação do Mastra:** o Mastra devolve o erro ao modelo e o ciclo **continua**; o modelo pode emitir outra submissão.
- **Resposta textual sem submissão aceita:** o ciclo termina sem sucesso.
- **Geração depois do término:** qualquer geração do modelo depois do passo com submissão aceita ou passo violado é **defeito do instrumento (I1)**, não falha do modelo. Isso inclui uma `submitInterpretation` emitida depois de outra aceita.

### Assimetria das duas validações

| Validação | Onde | Efeito no ciclo | Métrica afetada |
| --- | --- | --- | --- |
| Do Mastra, **tolerante** (troca `undefined` por `null`, remove nulos, converte JSON escrito como texto, aceita apelido de campo) | Antes do `execute` | Inválida: erro devolvido, o modelo pode corrigir. Válida por coerção: executa, é aceita e **encerra o turno** | **Protocolo** (aceitação) |
| Zod **estrito**, nos argumentos crus | No registro, depois do turno | Nenhum | **Zod** (e, por consequência, intenção e entidades) |

- **A pontuação é falha de schema nos dois casos de submissão inválida:**
  - recusada pelo Mastra: o Zod estrito também reprova;
  - aceita pelo Mastra por coerção, mas reprovada pelo Zod estrito.
- **Submissão coagida:** o turno termina sem chance de correção. O protocolo pode estar correto, porque foi uma só, sozinha e aceita, mas o Zod reprova.
- [Inferência, conferida em teste] Toda submissão inválida para o Mastra também é inválida para o Zod estrito, porque o Mastra usa o mesmo schema com mais tolerância.

## Falhas do modelo × invariantes do instrumento

### Falhas do modelo: códigos registrados

No denominador de 18, como na V1. **Um resultado pode ter vários códigos.** Os códigos registram fatos do turno; **as métricas derivam só das definições da seção "Avaliação de cada resultado"**, não desta tabela.

**Erro de execução:** os mesmos `EXEC_*` da V1 (`EXEC_PROVIDER_ERROR`, `EXEC_TIMEOUT`, `EXEC_RATE_LIMIT`, `EXEC_QUOTA`, `EXEC_FRAMEWORK`, `EXEC_CONTEXT_TRUNCATED`, `EXEC_EXTERNAL_EFFECT`). Como na V1, o turno com `EXEC_*` é incorreto em todas as métricas.

**Erro semântico:**

| Código registrado | Quando é registrado |
| --- | --- |
| `SEM_PROTOCOL_MISSING` | Nenhuma `submitInterpretation` emitida no turno |
| `SEM_PROTOCOL_NOT_ACCEPTED` | Pelo menos uma emitida e nenhuma aceita |
| `SEM_PROTOCOL_MULTIPLE` | Mais de uma emitida antes do término: no mesmo passo, ou em passos diferentes depois de uma recusa do Mastra |
| `SEM_PROTOCOL_SAME_STEP` | `submitInterpretation` emitida no mesmo passo que outra chamada |
| `SEM_INVALID_INTERPRETATION` | Não há interpretação avaliada que passe no Zod estrito (ausente ou reprovada) |
| `SEM_WRONG_INTENT`, `SEM_WRONG_TOOL`, `SEM_WRONG_TOOL_ARGS`, `SEM_WRONG_ENTITIES`, `SEM_WRONG_MISSING_FIELDS` | Como na V1 |
| `SEM_REASONING_LEAK` | Raciocínio na interpretação avaliada, nos argumentos crus, no texto ou em dado persistido |

Exemplos de combinação:

| Situação | Códigos de protocolo e schema | Protocolo | Zod, intenção, entidades |
| --- | --- | --- | --- |
| Submissão única, sozinha, aceita, válida | — | Correto | Avaliados na submissão |
| Recusada pelo Mastra, depois corrigida e aceita | `SEM_PROTOCOL_MULTIPLE`, `SEM_INVALID_INTERPRETATION` | Incorreto | Incorretos (só a primeira conta) |
| Recusada pelo Mastra, sem correção | `SEM_PROTOCOL_NOT_ACCEPTED`, `SEM_INVALID_INTERPRETATION` | Incorreto | Incorretos |
| Aceita por coerção, reprovada pelo Zod estrito | `SEM_INVALID_INTERPRETATION` | Correto | Incorretos |
| Com tool de negócio no mesmo passo | `SEM_PROTOCOL_SAME_STEP`, `SEM_PROTOCOL_NOT_ACCEPTED`, `SEM_INVALID_INTERPRETATION` | Incorreto | Incorretos (não há interpretação avaliada) |
| Duas no mesmo passo | `SEM_PROTOCOL_MULTIPLE`, `SEM_PROTOCOL_NOT_ACCEPTED`, `SEM_INVALID_INTERPRETATION` | Incorreto | Incorretos |
| Só texto | `SEM_PROTOCOL_MISSING`, `SEM_INVALID_INTERPRETATION` | Incorreto | Incorretos |

### Invariantes do instrumento

Elas não dependem do modelo: se o instrumento estiver correto, valem sempre.

| # | Invariante |
| --- | --- |
| I1 | Zero gerações do modelo depois do passo com submissão aceita ou passo violado (inclui submissão emitida depois de outra aceita) |
| I2 | Zero execuções de tool de negócio (`EXECUTED` ou `THREW`) em passo violado. **Rede de segurança** caso a premissa de ordem falhe com provider real |
| I3 | No máximo uma submissão aceita por turno, e nenhuma aceita em passo violado |
| I4 | Reconciliação completa (seção "Reconciliação"): B1 (emissão ↔ evento, nas duas direções), B2 (argumentos no caminho por `toolCallId`), B3 (`toolLog` × execuções) e a checagem cruzada do desfecho |
| I5 | Nenhum chunk `tool-call` de um passo chega depois do selo da guarda naquele passo |

- **Onde são conferidas:** em cada registro, **inclusive no aquecimento**. As cinco (I1–I5) também em cada **tentativa anterior** de um turno (interrompida por 429; não pontuada), conferidas como turno não concluído. Cada tentativa guarda emissões, passos, eventos, aceites, término, `toolLog` e chamadas. Uma submissão aceita seguida de 429 aparece como geração depois do aceite (I1): a geração que falha também é um passo, com `finishReason` `error`. O `scoreTurn` da V1 não lê `previousAttempts`, então a vista V1 não precisa mapeá-las.
- **Violação × diagnóstico:** a direção inversa da I4 (emissão ou registro da tool falsa sem o evento correspondente) só é **violação em turno concluído**. Num turno com `EXEC_*`, ou numa tentativa anterior, o turno parou no meio, e o achado é **diagnóstico**: fica no resumo e não aborta a rodada. A contagem por tool também é só diagnóstico.
- **O que acontece numa violação:** **a rodada daquele modelo é abortada na hora**, sem executar os turnos restantes, e fica sem veredito, como defeito do instrumento.
  - Não reprova o candidato e não entra no denominador.
  - O registro gravado indica qual invariante falhou e em qual turno.
  - Corrigir o instrumento depois do congelamento exige novo manifesto e nova rodada.

## Tools de negócio × tool de protocolo

- **Métrica de tool de negócio:** só as quatro tools de negócio, com as regras da V1, julgadas pelas **chamadas emitidas**: executadas, recusadas pela validação do Mastra **ou recusadas pela guarda de passo**.
- **`submitInterpretation`:** não conta na métrica de tool de negócio, nem quando o esperado é "nenhuma". É avaliada só na métrica de protocolo.
- **Qualquer outro nome de tool:** `SEM_WRONG_TOOL`, como na V1. Uma tool chamada `json` na V2 é tool incorreta, porque não há mais saída estruturada nativa.

### Reconciliação

**Implementação nova; a reconciliação da V1 não é reutilizada** (ela comparava `JSON.stringify`, sensível à ordem das chaves: artefato do C4, Groq, repetição 1).

**Três fontes, em formas diferentes** (conferido em `hook-input.test.ts` com entradas que o Mastra coage):

| Fonte | O que contém |
| --- | --- |
| Emissão (chunk `tool-call`) | Argumento **cru** |
| Evento (`beforeToolCall` / `afterToolCall`, `ctx.input`) | Argumento **cru** |
| `toolLog` (registro do `execute` das tools falsas) | Argumento **coagido** pelo Mastra |

**Cada comparação usa formas da mesma natureza:**

- **Emissão × evento** (B2 e recurso alternativo): os dois lados são crus, então a comparação é por **JSON canônico cru**, sem coerção, sejam os argumentos válidos ou não. Crus diferentes que coagem para o mesmo valor (`{query:"vpn", extra:null}` × `{query:"vpn"}`) **divergem**. Dois argumentos inválidos diferentes também divergem: ser inválido não autoriza a divergência.
- **`toolLog` × evento** (B3): o `toolLog` é coagido, então os dois lados vão para a forma coagida, `validateToolInput(schema, argumento).data` (a função do Mastra devolve `{ data }` ou `{ error }`), em JSON canônico. Um argumento recusado não tem forma coagida e é comparado cru.
- **Validade na captura (`validAtCapture`):** a validade de cada emissão e de cada evento é calculada por `validateToolInput` **na captura**, sobre o valor **original**, antes da remoção de raciocínio. Só o booleano é gravado. A remoção pode mudar a validade. Exemplo testado: uma `submitInterpretation` com `entities` em texto JSON e `<think>` não fechado (`'{"problem":"<think>ver chamados"}'`) é válida no original, porque o Mastra converte o texto em objeto. A regex de marcador apaga de `<think>` até o fim do texto, e o valor gravado fica inválido. A checagem cruzada e o `rejected` da vista V1 usam esse booleano.
- **Remoção de raciocínio:** é aplicada às três fontes antes de gravar, com a mesma função.

- **Desfechos do evento:**
  - `EXECUTED`: o `execute` rodou e devolveu;
  - `MASTRA_REFUSED`: a validação do Mastra recusou a entrada;
  - `GUARD_REFUSED`: a guarda de passo recusou;
  - `THREW`: o `execute` lançou erro; o `afterToolCall` recebe `error`, e o erro é registrado com nome e mensagem sanitizados.
- **Captura:**
  - o `toolCallId` da emissão vem do chunk `tool-call`;
  - o dos eventos vem do contexto dos hooks (`context.toolCallId`);
  - o do aceite vem do `execute` da submissão (`context.agent.toolCallId`);
  - nada disso altera as tools de negócio.
- **B1, emissão ↔ evento, nas duas direções:**
  - toda execução tem emissão; evento sem emissão é violação em qualquer turno;
  - toda emissão de tool conhecida tem **exatamente um** evento (`EXECUTED`, `MASTRA_REFUSED`, `GUARD_REFUSED` ou `THREW`);
  - emissão sem evento é violação só em turno concluído, e diagnóstico em turno com `EXEC_*`.
- **B2, chave primária (passo, `toolCallId`):** cada evento casa com exatamente uma emissão de mesmo nome, e os argumentos crus do evento são iguais aos da emissão, em JSON canônico cru.
- **B3, `toolLog` × execuções:** multiconjunto por nome + forma coagida.
  - Toda `EXECUTED` de negócio tem registro.
  - Um registro sem `EXECUTED` só é aceito se houver `THREW` equivalente, porque o `execute` pode ter registrado e depois lançado.
  - Registro sem execução segue a regra da direção inversa: violação em turno concluído, diagnóstico em turno com `EXEC_*`.
- **Checagem cruzada do desfecho:** `MASTRA_REFUSED` com `validAtCapture` verdadeiro, ou `EXECUTED`/`THREW` com `validAtCapture` falso, é inconsistência e conta como violação.
- **Aceites:** cada submissão aceita corresponde a uma execução da `submitInterpretation`.
- **Recurso alternativo, quando o provider não entrega `toolCallId` ou entrega repetido no passo:** multiconjunto por nome + JSON canônico cru, comparando emissões com eventos, **sem deduplicação**. O registro indica que o recurso alternativo foi usado.
- **Limitação da I4 no recurso alternativo:** chamadas com o mesmo nome e os mesmos argumentos crus são indistinguíveis individualmente. A I4 confere só as contagens, não a correspondência chamada a chamada.

## Avaliação de cada resultado

Com o gabarito do caso em `cases.json`. Um turno com `EXEC_*` é incorreto em todas as métricas.

1. **Protocolo correto:** **exatamente uma** `submitInterpretation` emitida no turno; **sozinha** no passo; **aceita** pelo Mastra. O Zod estrito **não** entra no protocolo.
2. **Interpretação válida (Zod):** existe interpretação avaliada e ela passa no Zod estrito.
3. **Intenção correta:** interpretação válida e `intent` igual ao gabarito.
4. **Tool de negócio correta:** regras da V1 sobre as chamadas de negócio emitidas.
5. **Entidades e missingFields:** interpretação válida e regras da V1.

- **Como as regras da V1 são aplicadas:** os itens 2 a 5, o C6 e a chave de estabilidade são calculados pelo `scoreTurn` da V1, sem alteração. Ele recebe uma "vista V1" do registro da V2: interpretação = interpretação avaliada; chamadas de negócio = emitidas; outros nomes de tool = chamadas desconhecidas.
- **`rejected` na vista V1:** marca, como na V1, a chamada cujos argumentos a validação do Mastra recusa. É o `validAtCapture` da emissão: a mesma função do Mastra (`validateToolInput`, de `@mastra/core/tools`), aplicada na captura ao valor original, para toda chamada, inclusive as recusadas pela guarda, que o Mastra não chega a validar. O desfecho registrado no evento não entra no cálculo; ele é conferido contra o cálculo na I4. Assim, a guarda pesa no protocolo e na interpretação, não na escolha da tool.
- **Gabaritos e representação:** regras **iguais à V1** (presença, valores, missingFields, campos extras, ausente × `null`, catálogos com caixa, texto livre normalizado, ordem indiferente).

## Limites de aprovação

Um candidato é aprovado na V2 se atender a E1–E4, **a rodada não tiver violação de invariante** e todos os limites forem atendidos:

- **protocolo correto: ≥ 17 de 18** (limite novo, igual ao do Zod);
- interpretação válida pelo Zod: ≥ 17 de 18;
- intenção correta: ≥ 15 de 18 e maioria correta em ≥ 5 de 6 entradas;
- tool de negócio correta: ≥ 15 de 18 e maioria correta em ≥ 5 de 6;
- entidades e missingFields: ≥ 15 de 18;
- estabilidade: mesma intenção e mesmo conjunto de tools de negócio emitidas nas 3 repetições em ≥ 4 de 6 entradas, e ≥ 2 concordantes nas demais;
- "Parou tudo!" (C6): as 3 execuções com o impacto e a ação esperados (definição da V1, sobre a interpretação avaliada);
- vazamento de raciocínio, truncamento de contexto (só aprova com os 18 em `NOT_DETECTED`) e efeitos externos: zero.

Os limites herdados são calculados pelo `aggregate` da V1, sem alteração; a V2 acrescenta o protocolo e as invariantes. Uma interpretação inválida ou ausente, ou um turno com `EXEC_*`, não concorda com nenhuma outra.

## Critérios classificatórios

Entre os aprovados, nesta ordem: (1) confiabilidade do contrato: protocolo, Zod e tool de negócio; (2) qualidade da interpretação; (3) estabilidade; (4) latência mediana; (5) recursos. Desempate: simplicidade para rodar. O spike recomenda; a decisão é do ADR-009.

## Segurança

- **Raciocínio do provider:** descartado e **nunca persistido**, como na V1.
- **Checagem de vazamento:** como checagem de segurança, sobre a interpretação avaliada, os argumentos crus de todas as chamadas emitidas (e os de seus eventos e do `toolLog`) e o texto. Tolerância zero. O conteúdo detectado é removido antes de gravar.
- **Política por origem do argumento** (`v2/src/leak.ts`; o `src/run.ts` da V1 não muda):
  - **`submitInterpretation`** (a interpretação): regra completa da V1 (`redactReasoningValue`: marcador de texto + nome de chave), sem mudança. O `interpretationSchema` não declara nenhuma chave que case com `/reason|think|thought/`, então a regra por chave nunca atinge um campo legítimo dele.
  - **Tools de negócio:** marcador de texto (`<think>`, canal `analysis`, `<reasoning>`) em todos os valores; regra por nome de chave (`/reason|think|thought/`) mantida, **exceto para os caminhos declarados no schema da tool**. A isenção vale pelo **caminho**, não pelo nome: só `reason` no topo do `requestHandoff` é isento. Um `reason` aninhado onde o schema não o declara continua sujeito à regra.
  - **Tool desconhecida** (sem schema): regra completa da V1, sem isenção.
  - O `REASONING_KEY` da V1 não é exportado; a V2 o repete, e um teste confere o padrão e as flags contra o literal no código da V1.
  - **Limitação dos caminhos declarados:** eles são lidos do JSON Schema gerado pelo Zod, percorrendo só `properties`. `items`, `anyOf`/`oneOf` e `$ref` não são percorridos. Um campo declarado dentro dessas construções não é reconhecido como declarado e fica sujeito à regra por chave, ou seja, o efeito é **remoção a mais, nunca a menos**. Nas quatro tools atuais, nenhum campo que case com `/reason|think|thought/` está dentro dessas construções.
- **Registros:** sem segredos e sem cabeçalhos (só `retryAfterSeconds`), como na V1.
- **Motivo da política (decidido em 2026-11-12):** aplicada sem isenção aos argumentos das tools, a regra por chave marcava o `requestHandoff.reason` legítimo como vazamento. Um C5 correto recebia `SEM_REASONING_LEAK`, e o motivo era apagado do registro.

## Reutilização da V1

**Só módulos cuja importação não tem efeito colateral.** A CLI do `../src/run.ts` só roda com `import.meta.main`, e os outros módulos importados não fazem E/S no carregamento. Um teste importa os módulos num processo separado e confere que nada é impresso nem gravado.

| Módulo da V1 | O que a V2 usa |
| --- | --- |
| `../src/tools.ts` | `createFakeTools`, `TOOL_INPUT_SCHEMAS` |
| `../src/schema.ts` | `interpretationSchema` |
| `../src/fixtures.ts` | (indireto, pelas tools e pelo score) |
| `../src/models.ts` | `spikeModels` |
| `../src/cases-schema.ts` | `casesFileSchema` |
| `../src/run-record.ts` | `BUSINESS_TOOLS`, `INPUT_TOKEN_BUDGET`, tipos `ExecCode`, `SemCode`, `TurnRecord`, `RateLimitEvent`, `ModelCallRecord`, `ContextCheck` |
| `../src/run.ts` | `MODEL_SETTINGS`, `REASONING_CONTROL`, `ollamaEnvProblem`, `toMessages`, `redactReasoningText`, `redactReasoningValue`, `sanitize`, `withSanitizedConsole`, `classifyError`, `QuotaExhausted` (o `REASONING_KEY` não é exportado: repetido em `v2/src/leak.ts`, com teste de identidade) |
| `../src/score.ts` | `scoreTurn`, `aggregate` |

**Reescritas na V2 com o mesmo comportamento**, porque a V1 não as exporta: monitor de requisições externas, estimativa de tokens de entrada (com o prompt da V2), estado do truncamento, laço de novas tentativas, aquecimento, `providerOf` e `allowedHostsOf`. Os testes da V2 cobrem cada uma.

## Sondagens de capacidade (depois do congelamento, antes das rodadas)

Com entradas próprias, **fora dos seis casos**, gravadas em `v2/results/probes/`. Elas informam e não aprovam nada.

| # | Pergunta | Por quê |
| --- | --- | --- |
| P1 | `tool_choice: "auto"` é transmitido e aceito por cada provider? | O Ollama não declara suporte a `tool_choice` |
| P2 | Sem `response_format`, o modelo chama tools por este caminho, incluindo a `submitInterpretation`? | Na V1, os dois modelos do Ollama não fizeram nenhuma chamada de tool em 36 turnos |
| P3 | O provider entrega `toolCallId` único por chamada? | Chave primária da reconciliação |
| P4 | O provider emite chamadas paralelas num passo? | Frequência esperada de passos violados |

## Testes com o dublê (antes do congelamento)

Sem modelo real, com o `MastraLanguageModelV2Mock` e respostas HTTP fabricadas:

1. **(a)** Negócio → submissão sozinha: aceita; nenhuma geração depois.
2. **(b)** Negócio → negócio + submissão: o primeiro passo executa; o segundo é todo recusado, e a tool de negócio dele não executa; `SEM_PROTOCOL_SAME_STEP`; nenhuma geração depois.
3. **(c)** Duas submissões no mesmo passo, executadas em paralelo: nenhuma aceita; `SEM_PROTOCOL_MULTIPLE`.
4. C6: submissão sozinha, sem tool de negócio.
5. Só texto: `SEM_PROTOCOL_MISSING`.
6. Recusada pelo Mastra, depois corrigida: `SEM_PROTOCOL_MULTIPLE` + `SEM_INVALID_INTERPRETATION`; intenção e entidades avaliadas só na primeira.
7. Aceita por coerção do Mastra e reprovada pelo Zod estrito: protocolo correto, Zod incorreto, turno encerrado.
8. `maxSteps` esgotado só com tools de negócio: exatamente 5 gerações, prova de que o `stopWhen` não anula o `maxSteps`; `SEM_PROTOCOL_MISSING`.
9. Nome de tool desconhecido sozinho, e junto com a submissão: nenhum efeito; submissão bloqueada; `SEM_PROTOCOL_SAME_STEP`.
10. Caminhos reais com respostas HTTP fabricadas:
    - Ollama (router) e Groq (`@ai-sdk/groq`) usam `doGenerate` (sem `stream: true`);
    - a guarda funciona por esses caminhos, com tool de negócio + submissão no mesmo passo.
11. `doStream` com atraso entre os chunks `tool-call`:
    - sem execução antecipada (agendamento do `generate`): nenhum `beforeToolCall` antes de a composição do passo estar completa; todas as chamadas do passo violado bloqueadas, também sob concorrência;
    - com a execução antecipada do `stream`: a premissa quebra, e a I2 e a I5 detectam.
12. Reconciliação. Cada regra é testada nos dois sentidos: dispara quando deve e não dispara quando não deve.
    - o que o `ctx.input` contém em cada hook (cru) e no `execute` (coagido), com entrada coagível;
    - regressão do C4: argumentos em ordem de chaves diferente da do schema, uma chamada, uma execução;
    - B1: emissão sem evento (violação em turno concluído; diagnóstico com `EXEC_*`); evento sem emissão;
    - B2: mesmo id com argumentos divergentes, e com argumentos equivalentes depois da coerção;
    - B3: `toolLog` com argumentos divergentes, e com a forma coagida;
    - chamada coagida pelo Mastra, com e sem `toolCallId`: sem violação;
    - ids ausentes, e ids repetidos com argumentos iguais e com argumentos diferentes;
    - guarda recusando, com argumentos válidos e com argumentos inválidos;
    - `rejected` pela validação e checagem cruzada do desfecho;
    - `THREW`, inclusive em passo violado (I2);
    - I2 e I4 nas tentativas anteriores.
13. Verificador de invariantes, com registros fabricados para I1–I5: invalida a rodada; violação no aquecimento aborta antes dos turnos.
14. Identidade com a V1:
    - SHA-256 dos arquivos compartilhados iguais aos da V1;
    - `maxSteps`, tempo limite e tentativas iguais aos do código da V1;
    - prompt igual ao da V1, exceto as duas linhas documentadas.
15. Importação dos módulos da V1 sem efeito colateral.
16. Digest do Ollama lido de `/api/tags` do mesmo servidor (resposta fabricada); `null` quando o modelo não aparece.
17. V2.1: verificação de truncamento só com passos de inferência, testes (a)–(g) em `context-check.test.ts` e (h) em `identity.test.ts` (seção "V2.1").

## Limitações declaradas

- **`proposeTicketUpdate` não é coberta:** o README §6 e o ADR-001 citam essa tool, mas ela não existe no spike (V1 e V2).
- **PendingAction única só no papel:** a invariante 7 do DM §7.1 ("no máximo uma ação em `PENDING_CONFIRMATION` por conversa") está documentada, mas não é imposta por código nem por persistência (não há app web, nem modelo `PendingAction` no Prisma). O ADR-001 não muda nesta etapa.
- **Cenário concreto para o Bloco 5:** o Mastra executa em paralelo as tools de um mesmo passo (até 10 por padrão), então duas `proposeTicketDraft` na mesma resposta seriam duas criações concorrentes de PendingAction na mesma conversa.
- **Texto ao funcionário não avaliado** na V2.
- **Validação estrita × tolerante:** a validação do Mastra continua tolerante no ciclo; a V2 mede pelo Zod estrito, mas não impede que o Mastra aceite e execute uma submissão coagida.
- **Premissa de ordem da guarda:** garantida pelo agendamento do `Agent.generate` no Mastra 1.81.0 e falsa no `Agent.stream()` com execução antecipada. Com provider real, é conferida pela I5 e protegida pela I2. Trocar `generate` por `stream` invalida a guarda.
- **Reconciliação por multiconjunto:** quando usada, só confere contagens (I4).
- **Caminhos declarados (`leak.ts`):** só `properties` do JSON Schema são percorridos; `items`, `anyOf`/`oneOf` e `$ref` não. O efeito possível é remoção a mais, nunca a menos (seção "Segurança").
- **O manifesto não congela o typecheck:** os `tsconfig` (V1 e V2) ficam fora. Um typecheck diferente não muda execução nem pontuação.
- **Turno `EXEC_*` sem nenhuma inferência continua `UNKNOWN` (V2.1):** por exemplo, um turno cujo único passo é `error`. Pela regra dos 18 em `NOT_DETECTED`, isso reprova o requisito de truncamento mesmo dentro da tolerância de 17/18 de outros limites. O `aggregate` da V1 é reutilizado sem mudança, e não se imputa `NOT_DETECTED` sem evidência.
- **Groq fora da aprovação** (E4), como na V1.

## Ordem de trabalho

1. Critérios → aprovação (feita, com ajustes).
2. Implementação e testes com o dublê → revisão.
3. Manifesto (gravado em 2026-11-12) e commit de congelamento.
4. Sondagens P1–P4.
5. Rodadas.

## Arquivos (manifesto)

**V2.1, congelada em 2026-11-13** (fins de linha LF, como fixa o `.gitattributes` da raiz). A tabela da V2 original (28 arquivos, congelada em 2026-11-12) não está mais neste arquivo no formato lido pelo `verifyManifest`; ela fica no commit `e0469db` (`git show e0469db:spikes/llm-model/v2/CRITERIA.md`). Na V2.1 mudam `v2/src/run.ts` (regra nova) e `v2/src/identity.test.ts` (uma única tabela ativa), e entra `v2/src/context-check.test.ts`: 29 arquivos. Entram:

- **Da V1, importados sem cópia:**
  - com o SHA-256 do manifesto da V1: `src/prompt.ts` (o run da V1 o importa), `src/schema.ts`, `src/models.ts`, `src/fixtures.ts`, `src/tools.ts`, `src/cases-schema.ts`, `cases.json`, `package.json`, `package-lock.json`, `.npmrc`;
  - fora do manifesto da V1, idênticos ao commit `2182d6b`: `src/run-record.ts`, `src/run.ts`, `src/score.ts`.
- **Novos:** `v2/src/prompt.ts`, `v2/src/protocol.ts`, `v2/src/leak.ts`, `v2/src/record.ts`, `v2/src/run.ts`, `v2/src/score.ts`, `v2/src/test-helpers.ts` e os testes (inclusive `v2/src/context-check.test.ts`, da V2.1).
- **Fora, auxiliares:** `v2/src/probe.ts` e `v2/src/probe.test.ts` (sondagens P1–P4) e `v2/src/mastra-behavior.test.ts` (medições do Mastra). Não fazem parte do instrumento das rodadas; a CLI da sondagem exige este manifesto íntegro (29/29).
- **Fora:**
  - **`src/check-cases.ts`**, que está no manifesto da V1: a V2 não o importa nem o executa. Os casos que ele valida (`cases.json`) entram no manifesto com o hash da V1, e o `cases-schema.ts` que os valida também.
  - **Nenhum dos dois `tsconfig`, nem o da V1 (`tsconfig.json`) nem o da V2 (`v2/tsconfig.json`):** só servem ao typecheck (`noEmit`). O Node executa os `.ts` removendo os tipos e não lê `tsconfig`, então nenhum dos dois afeta a execução nem a pontuação. O `v2/tsconfig.json` estende o da V1; congelar um sem o outro não garantiria o mesmo typecheck.

| Arquivo | SHA-256 |
| --- | --- |
| `src/prompt.ts` | `2d9054d371d893e2c4deca6b91f82e3a6d7ddc0ecc7a811da8ad382937d84638` |
| `src/schema.ts` | `c8e63fb1037a4c5bdb2d0d47a6a82c891110e6ddd5097aa2aefa173876be30ee` |
| `src/models.ts` | `3c6325afd35001c74c9e5cee5de156db6eb0273d817a6afc5defa9a9412fcb13` |
| `src/fixtures.ts` | `86d119a67a973c93b0be7511b9372771b462c156eb54b53d35dff62d530d1a30` |
| `src/tools.ts` | `5e62f88c67469dd950c9fdb3a5abedd43fe657397a35a7b1150753ea67de4b6f` |
| `src/cases-schema.ts` | `00f691ef2a5d7fa5e9e4f37bbc6ebacd13f387dbd3b6fd9a352f3f00821eb651` |
| `cases.json` | `1be41676436e7ad525daebfe664d8aae3f8f433a18df5b5c79af9146e14db8b1` |
| `package.json` | `bad59360700c962a51defbf1fb16c3a453695958871094e2a5a18e8373d9df3c` |
| `package-lock.json` | `45dbd0a87570ac072dc55f88c7691b342cec044537e1739dc695111a57b96d41` |
| `.npmrc` | `5930232d94754837f39a55b068e2deeefd8f1adea88bd8c55e205f0e832bb32f` |
| `src/run-record.ts` | `cc84367577b246570bc624f799c233db41bf7b0cfecf205d80f57c35f1570aad` |
| `src/run.ts` | `76ff80eed6f0980cd9d1596590b6589af26b1b03c4eaf6796e5bd7aaddd90472` |
| `src/score.ts` | `69289cfab64a150bad79036a13ae457fd796d93a8fbe9aa1cbbf3ff09d6d4719` |
| `v2/src/prompt.ts` | `00e77722405ef730e2d7ccee78e956692e7c26057b6a1096179f380bb1df7214` |
| `v2/src/protocol.ts` | `d4012db65e215f7f75b0820a8249de40956501133a278231901dc0a27eabb6ba` |
| `v2/src/leak.ts` | `88821444d5f250fbbd148c3933fb5728ca561d5e20327320e9929b8983b42213` |
| `v2/src/record.ts` | `c1d51d4474331eb76a98d08a7a11ca0f23473d72bdb01689826d36867259eb85` |
| `v2/src/run.ts` | `5d3504c7ae4a9bb4b278129efe11f3448ed9734013782c72215b2ec18afa7527` |
| `v2/src/score.ts` | `00a90e712c18ad1ee30a006eed81d362c7ee531e2f4a4feb38b112007dc7e13e` |
| `v2/src/test-helpers.ts` | `1b51142d054d377cf4453ca79f0c3ae3c3419878a328ab67a7569916b4d526b5` |
| `v2/src/context-check.test.ts` | `c3728d9529a84eda55a2f1062b00013bba500dcef66406aa974c14a8eef5fbdf` |
| `v2/src/hook-input.test.ts` | `dcde0da3e0632be4908c9f95966fe4530409443a8eb0fba3ecf2dbf9732addf5` |
| `v2/src/identity.test.ts` | `ca6f8bd8d6a996d38c6831c2275b3e414c1bc6fb0d915f95703427869ffeae6b` |
| `v2/src/leak.test.ts` | `6b1e541583a14eb32a2671f62966b5642f82778cda1c20d0cf75d87df84811f9` |
| `v2/src/protocol.test.ts` | `7202adfc880bab1742b151970dc3b8aa9b79fc035a4633f947843551be7fd65d` |
| `v2/src/provider-path.test.ts` | `511548b3bddf3073934ac55555821e525c1daa93f83c007cd27265a90e2c5ef3` |
| `v2/src/reconcile.test.ts` | `a18696a9766443e846872804ea5bcd44e9f0c1c1fa0cb14bd67873bc77b81360` |
| `v2/src/retry.test.ts` | `ecd352684ccd932167395d53bf9294fe856d653f71e7220598188faa6b366d1a` |
| `v2/src/score.test.ts` | `b653532cfdc63cf278bf86bab8aefb6aa067c269d208bfa6336499459a08a6e1` |

Conferência, na pasta `spikes/llm-model/`: `sha256sum -c` sobre as linhas `<hash>  <arquivo>` desta tabela, ou o `identity.test.ts` ("manifesto da V2.1").

**Escopo do manifesto:** congela os **artefatos de execução e de pontuação** (o que roda no turno, o que pontua e o que os testes do dublê exercitam), **não o typecheck**. Este arquivo e o `v2/README.md` ficam fora, como na V1. A CLI da V2 só executa com a tabela presente e todos os hashes iguais.
