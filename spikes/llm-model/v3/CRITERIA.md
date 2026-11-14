# Spike do ADR-009, V3: interpretação em chamada separada (D1)

**Estado: CONGELADO em 2026-11-14**, antes de qualquer rodada oficial. Critérios aprovados em 2026-11-13, com os ajustes da implementação de 2026-11-14 (seção "Ajustes da implementação"). Os SHA-256 da seção "Arquivos (manifesto)" conferem o congelamento; a CLI da V3 e o `identity.test.ts` os verificam. Mudar o desenho, o prompt, as tools, as fixtures, os casos ou o instrumento depois do congelamento invalida a comparação e exige novo manifesto.

## Pergunta da V3

**Se o código garante a sequência (ferramentas → interpretação), o modelo produz uma interpretação correta e completa?**

Uma variável muda em relação à V2.1: a interpretação sai de uma **chamada separada, disparada pelo código** (D1), e não de uma tool terminal escolhida pelo modelo (D2).

**Motivo.** Nas rodadas da V2.1 do Ollama (commit `4703531`), nenhum candidato foi aprovado, e o padrão de falha foi o mesmo nos dois modelos: **a tool de negócio certa, e depois texto em vez da submissão.**

- **`qwen3:4b-instruct`:** tool de negócio correta em **18 de 18**. Nos 15 turnos de C1–C5, a sequência tool → `submitInterpretation` aconteceu em **só 3** (as três repetições do C2). Nos outros 12, o modelo chamou a tool certa e terminou com texto (passos `tool-calls`, `stop`), sem emitir a submissão (`SEM_PROTOCOL_MISSING`). Protocolo e Zod: 6 de 18.
- **`qwen3:8b`:** protocolo em 9 de 18. Em C1, C3 e C5, a tool certa seguida de texto, sem submissão.

É o argumento central para a D1: o modelo escolhe a tool de negócio, mas não cumpre a sequência. Na V1, com saída estruturada nativa, a interpretação era válida pelo Zod em 18 de 18 no `qwen3:8b` e em 12 de 18 no `qwen3:4b-instruct`, mas nenhum modelo do Ollama chamou tool. A V3 separa as duas tarefas: a fase 1 só chama tools, e o código dispara a fase 2, que só interpreta.

## Relação com a V1 e a V2.1

- A V1 (commit `2182d6b`) e a V2.1 (commit `5b5338f`) ficam **intactas**: arquivos, critérios e resultados. A V3 é um **experimento independente**, com manifesto, critérios, testes e commit de congelamento próprios.

| Aspecto | V1 | V2.1 | V3 |
| --- | --- | --- | --- |
| Como sai a interpretação | Saída estruturada nativa, na mesma chamada das tools | Tool terminal `submitInterpretation` (D2) | Segunda chamada, sem tools, com saída estruturada (D1) |
| Quem decide a sequência | O modelo | O modelo (protocolo conferido) | O código |
| Tools de negócio, schema, fixtures, casos, gabaritos | — | Iguais à V1 | Iguais à V1 |
| Prompt | V1 | V1 com uma linha trocada | **V1, sem mudança, nas duas fases** |
| Configuração (temperatura, seed, limites, raciocínio, aquecimento, novas tentativas, `maxSteps`, tempo limite) | — | Igual à V1 | Igual à V1 (fase 2 com `maxSteps: 1`; 180 s por tentativa, compartilhados pelas duas fases) |
| Pontuação | `scoreTurn` e `aggregate` | Os da V1 + protocolo | **Os da V1, sem limite de protocolo** |
| Truncamento | Todos os passos | Só passos de inferência | Só passos de inferência, **por fase invocada**, combinado |
| Interpretação avaliada | `result.object` (depois das coerções do Mastra) | Argumentos crus da primeira submissão | **`JSON.parse(result.text)`** (cru) |

- **Comparação V1 × V2.1 × V3:** descritiva, métrica a métrica, sobre as mesmas entradas e gabaritos. A V3 tem aprovação própria; os resultados da V1 e da V2.1 não entram no da V3.

## Não é baseline

Igual à V1 e à V2.1: **ainda não existe baseline oficial.** Este spike seleciona modelo para o ADR-009 (README §10).

## Desenho (D1, dois Agents)

### Fase 1: tools de negócio

- **Agent** com as quatro tools de negócio da V1 (`searchArticles`, `listMyTickets`, `proposeTicketDraft`, `requestHandoff`), importadas de `../src/tools.ts` sem alteração. **Sem `submitInterpretation`** e sem `structuredOutput`.
- `toolChoice: "auto"`, passado explicitamente. `maxSteps: 5`, contando passos de inferência: no Mastra 1.81.0, passos `retry` não contam no `maxSteps` (medido na V2, `mastra-behavior.test.ts`), e um passo `error` encerra o ciclo.
- **Captura** com o `TurnProtocol` da V2.1 (`../v2/src/protocol.ts`), registrado **sem** a `submitInterpretation`. Sem ela, todo passo tem veredito `OK`, o `stopWhen` nunca encerra, e o término fica com o `maxSteps` ou com a resposta sem tool. No levantamento, com HTTP fabricado, ele registrou emissões, `validAtCapture`, eventos (`EXECUTED`, `MASTRA_REFUSED`) e passos sem defeito, e o `reconcile` da V2.1 passou sem problemas sobre essa captura.
- O texto produzido na fase 1 não é avaliado. Passa pela checagem de vazamento de raciocínio. O texto final fica fora da fase 2; o texto intermediário entra (seção "Transcrição").

### Fase 2: interpretação

- **Segundo Agent, sem nenhuma tool**, com `maxSteps: 1` e `structuredOutput: { schema: interpretationSchema, errorStrategy: "warn" }`. O schema é o da V1 (`../src/schema.ts`), sem mudança.
- **A requisição leva `response_format` e não leva `tools` nem `tool_choice`.** Medido no levantamento, com HTTP fabricado (Ollama pelo model router): as chaves do corpo foram `max_tokens, messages, model, response_format, seed, temperature`, e o `response_format` foi `{type: "json_schema", json_schema: {name: "response", strict: true, schema}}`, com o schema sem reescrita (campos opcionais continuam opcionais).
- **`errorStrategy: "warn"`** porque, no padrão (`strict`), uma saída recusada pela validação do Mastra **lança** `STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED` e o texto se perde. Com `"warn"`, o `text` fica disponível e o `object` fica ausente (medido).
- **`maxSteps: 1`** porque, num Agent sem tools, um tool call devolvido pelo modelo não executa nada, mas, com o `maxSteps` padrão, o Mastra faz uma segunda requisição. Com `maxSteps: 1`, faz uma só (medido).

### Por que dois Agents, e não `toolChoice: "none"`

**`toolChoice: "none"` não é mecanismo de segurança.** Medido no levantamento: no mesmo Agent com as quatro tools, `toolChoice: "none"` com saída estruturada nativa tira as tools da requisição (`stripToolsWhenNone`, `agent-DtdQ6un6.js:1093`), mas as tools continuam registradas no Agent. Quando a resposta fabricada trouxe um tool call, **o Mastra executou `listMyTickets`**, também com `maxSteps: 1`. Um Agent sem tools não tem o que executar.

### Prompt

`SYSTEM_PROMPT` da V1 (`../src/prompt.ts`, `spike-adr009-prompt-v1`), **sem mudança, nas duas fases, sem instrução adicional na fase 2**. Na saída estruturada nativa, o Mastra não injeta texto no prompt: o corpo da fase 2 tem só a mensagem de sistema e a conversa (medido). O que pede a interpretação é o `response_format`.

## Transcrição da fase 1 para a fase 2

- **Fonte:** `response.messages` do resultado da fase 1. Ele traz só as mensagens geradas na fase 1 (não o histórico do caso), no formato do AI SDK, com os tool calls, os resultados que o modelo viu e o texto final (medido).
- **Filtro:**
  - **preserva inteiras** as mensagens `assistant` com tool calls, **inclusive o texto intermediário** que vier junto, e as mensagens `tool` com os resultados, **inclusive as recusas de validação do Mastra** (o resultado de erro que o modelo recebeu);
  - **remove as partes de raciocínio** (`type: "reasoning"`) de todas as mensagens. Sem o filtro, o provider compatível com OpenAI devolve o raciocínio como `reasoning_content` no corpo da fase 2 (medido);
  - **exclui a última mensagem `assistant` sem tool call** (o texto final da fase 1).
- **Entrada da fase 2:** `[...toMessages(caso), ...transcrição filtrada]`. A conversa termina numa mensagem `tool` (quando houve tool) ou na mensagem do funcionário (quando a fase 1 não chamou tool). Nunca termina numa mensagem `assistant`.
- **Por que excluir o texto final:** mitiga o risco de *prefill*. Uma conversa que termina em `assistant` pode ser tratada pelo servidor como início de resposta a continuar (seção "Riscos").
- **Montagem manual descartada:** o resultado das tools não é capturado hoje (o `ExecutionEvent` da V2.1 não guarda a saída), e reconstruir a recusa de validação do Mastra seria reescrever o que o modelo viu.

## Interpretação oficial

- **`JSON.parse(result.text)` seguido do `interpretationSchema` estrito.** Sem remover cercas, sem extrair objeto de prosa, sem reparar JSON.
- **`result.object` é só diagnóstico** (coluna comparável à V1), nunca fonte oficial. É gravado só depois da remoção de raciocínio (seção "Segurança e registros").
- **Motivo:** antes do `object`, o Mastra remove cercas ```` ```json ````, extrai o último objeto balanceado de um texto com prosa, escapa caracteres de controle e **repara JSON parcial**. No levantamento, um JSON sem a última chave, com `finish_reason` `stop`, virou um `object` válido. A V1 lia o `result.object` primeiro, então aceitava essas coerções. A V3 é mais estrita que a V1 nesse ponto, e a coluna de diagnóstico mostra onde a diferença aparece.
- **`finishReason` `"length"`:** a interpretação oficial é `null`, **mesmo com JSON aparentemente completo**. A saída pode ter sido cortada num ponto que ainda forma JSON válido.
- **Fonte crua:** `result.text` é o `content` da resposta do provider; o raciocínio separado vai para `reasoningText`, não para o `text` (medido). O `result.response.body` traz o `reasoning_content` e **nunca é gravado**.
- **Remoção de raciocínio:** o `JSON.parse` é feito sobre o texto como veio. O texto e a interpretação gravados passam antes pela remoção da V1 (`redactReasoningText`, `redactReasoningValue`), e a presença de marcador gera `SEM_REASONING_LEAK`.

## Requisitos eliminatórios (E1 a E4)

E1, E3 e E4 **iguais à V1**.

**E2 na V3:** o modelo roda nos dois Agents do Mastra. A fase 1 **disponibiliza** as quatro tools de negócio, com `toolChoice: "auto"`, e o modelo as usa conforme o caso: chamar tool não é obrigatório, e o C6 continua exigindo zero tools de negócio. A fase 2 entrega a interpretação pela saída estruturada nativa, sem tools. Verificado em execução.

## Modelos e ordem das rodadas

Fixados antes de qualquer resultado da V3:

| Ordem | Caminho | Modelo |
| --- | --- | --- |
| 1 | Ollama, endpoint compatível com OpenAI pelo model router (`../src/models.ts`) | `qwen3:4b-instruct` |
| 2 | Ollama, mesmo caminho | `qwen3:8b` |

- **Os dois rodam a V3 inteira, sem condição entre eles.** O resultado do primeiro não decide se o segundo roda.
- **Groq fora da V3.** Segue só como referência da D2 na V2.1, sem adaptar schema nem `maxOutputTokens` (seção "Riscos").
- **Digest de cada imagem Ollama:** lido de `/api/tags`, como na V2.1 (`ollamaDigest`).

## Configuração

Idêntica à V1 (`../src/run.ts`):

- 3 repetições por caso, em sessões independentes (Agents novos, tools novas, sem memória).
- Temperatura 0, seed 42, saída máxima 512, `maxRetries: 0` no Mastra (`MODEL_SETTINGS`), **nas duas fases**.
- Entrada máxima 7680 tokens por chamada; contexto do servidor Ollama em 8192, conferido no `ollama ps`.
- Controle de raciocínio: `REASONING_CONTROL` da V1 (`reasoning_effort: "none"` no Ollama), **nas duas fases**.
- Aquecimento: um turno fora do denominador (`"Olá."`, sem histórico), com as duas fases e as invariantes conferidas.
- Novas tentativas: até 3 por turno, respeitando o `Retry-After` (seção "Novas tentativas").
- Fase 1 com `maxSteps: 5`; fase 2 com `maxSteps: 1`.
- **Tempo limite: 180 s por tentativa, compartilhados pelas duas fases.** Um único sinal de cancelamento é criado no início da tentativa e passado às duas fases: o tempo **não reinicia** na passagem da fase 1 para a fase 2. Uma nova tentativa por 429 começa um orçamento novo, como na V1. Estourar o tempo em qualquer fase dá `EXEC_TIMEOUT`.

## Unidade de medida

- **Resultado = um turno completo:** fase 1 e, quando ela não termina em `EXEC_*`, fase 2.
- **Denominador fixo: 18 por modelo** (6 casos × 3 repetições). Nenhum resultado é descartado.
- Latência do turno (das duas fases) e, por chamada interna de cada fase, tokens e latência.

## Novas tentativas

- **Um 429 em qualquer fase repete o turno inteiro**, fase 1 e fase 2, em sessão nova, como na V1 e na V2.1: até 3 tentativas, respeitando o `Retry-After`, cada uma com o seu orçamento de 180 s.
- **Cota diária esgotada é terminal:** o turno corrente fica com `EXEC_QUOTA`, e os restantes entram como não executados, sem nenhuma requisição.
- **Tentativas anteriores** (interrompidas por 429) guardam os dados das duas fases e passam pelas invariantes como turno não concluído, como na V2.1.

## Falhas do modelo × invariantes do instrumento

### Falhas do modelo: códigos

Os mesmos da V1, sem os códigos de protocolo da V2.1. **Um resultado pode ter vários códigos**, e as métricas derivam só da seção "Avaliação de cada resultado".

- **Erro de execução:** `EXEC_PROVIDER_ERROR`, `EXEC_TIMEOUT`, `EXEC_RATE_LIMIT`, `EXEC_QUOTA`, `EXEC_FRAMEWORK`, `EXEC_CONTEXT_TRUNCATED`, `EXEC_EXTERNAL_EFFECT`. O turno com `EXEC_*` é incorreto em todas as métricas.
- **Erro semântico:** `SEM_INVALID_INTERPRETATION`, `SEM_WRONG_INTENT`, `SEM_WRONG_TOOL`, `SEM_WRONG_TOOL_ARGS`, `SEM_WRONG_ENTITIES`, `SEM_WRONG_MISSING_FIELDS`, `SEM_REASONING_LEAK`.
- **Requisição a host fora do endpoint do modelo, em qualquer fase:** semântica igual à V1 e à V2.1. O `withRequestMonitor` da V2.1 **registra, sem bloquear**, e o turno recebe `EXEC_EXTERNAL_EFFECT` pelo `scoreTurn` da V1, contando contra o candidato e contra a tolerância zero. **Não é invariante nem defeito do instrumento.** Uma falha do próprio monitor, inclusive a incapacidade de determinar o host, é defeito do instrumento (seção "Falha do instrumento").

### Classificação das falhas da fase 2

| Situação na fase 2 | Classificação |
| --- | --- |
| Erro HTTP, do provider ou de transporte (inclusive tempo limite e 429 depois das tentativas) | `EXEC_*`, como na V1 |
| Texto vazio | `SEM_INVALID_INTERPRETATION` |
| JSON ausente ou inválido para o `JSON.parse` (inclusive cerca, prosa ou JSON truncado) | `SEM_INVALID_INTERPRETATION` |
| JSON válido reprovado pelo Zod estrito (campo extra, `null` em opcional, valor fora do catálogo) | `SEM_INVALID_INTERPRETATION` |
| `finishReason` `"length"`, mesmo com JSON aparentemente completo | `SEM_INVALID_INTERPRETATION` (interpretação oficial = `null`) |
| Tool call emitido sem interpretação válida | `SEM_INVALID_INTERPRETATION` + diagnóstico |
| Tool call emitido junto com interpretação válida | Diagnóstico; a interpretação é avaliada |

- **Tool call na fase 2 nunca é `SEM_WRONG_TOOL`:** a métrica de tool julga só a fase 1. O diagnóstico registra a contagem e os nomes, não os argumentos.

### Invariantes do instrumento

Elas não dependem do modelo: com o instrumento correto, valem sempre. **Uma violação aborta a rodada daquele modelo na hora**, sem veredito e fora do denominador, como na V2.1. São conferidas em cada registro, no aquecimento e em cada tentativa anterior.

| # | Fase | Invariante |
| --- | --- | --- |
| I1 | 1 | Nenhum chunk `tool-call` de um passo chega depois do selo do `TurnProtocol` naquele passo (I5 da V2.1) |
| I2 | 1 | No máximo 5 passos de inferência (`finishReason` diferente de `retry` e `error`) |
| I3 | 1 | Reconciliação da fase 1 pelo `reconcile` da V2.1, sem cópia, com `acceptedSubmissions: []`: emissão ↔ evento (B1, B2), `toolLog` ↔ execuções (B3) e checagem cruzada do desfecho, inclusive `MASTRA_REFUSED`. As regras de violação e de diagnóstico são as da I4 da V2.1 |
| I4 | 2 | Toda requisição da fase 2 é capturada, com corpo legível; nenhuma tem `tools` nem `tool_choice`; todas têm `response_format`. Captura que falha ou corpo ilegível é defeito do instrumento (seção "Falha do instrumento"). Só booleanos e contagens são gravados |
| I5 | 2 | No máximo um passo de inferência por tentativa |
| I6 | 2 | Nenhuma execução de tool, e o `toolLog` não cresce durante a fase 2 |
| I7 | 1→2 | A fase 2 roda exatamente uma vez por tentativa (uma chamada ao `generate` do segundo Agent), exceto se a fase 1 terminar em `EXEC_*`; nesse caso, zero vezes |
| I8 | 2 | Nenhum raciocínio (`reasoning_content`, ou parte `reasoning`) no corpo de nenhuma requisição da fase 2 |
| I9 | 2 | No máximo uma interpretação válida por tentativa |
| I10 | 1→2 | Transcrição fiel, em duas comparações: captura da fase 1 × transcrição filtrada, e transcrição filtrada × corpo real enviado na fase 2 (seção "Transcrição fiel") |

- **Numeração:** contínua. Em relação ao primeiro rascunho: entra a I3 (reconciliação); as antigas I3 a I7 passam a I4 a I8; a antiga I8 (hosts) sai; I1, I2, I9 e I10 não mudam.
- **I5 × I7:** a I7 conta as chamadas ao `generate` da fase 2, e a I5 conta os passos de inferência dentro dela. Uma fase 2 com 500, novas tentativas internas do Mastra e sucesso tem passos `retry` e um passo de inferência, e não viola nenhuma das duas. Uma fase 2 que termina em `EXEC_*` pode ter zero passos de inferência.
- **I3 × I10:** a I3 confere a fase 1 consigo mesma (o que foi emitido, o que os hooks viram e o que as tools falsas registraram). A I10 confere o que passou para a fase 2.

### Falha do instrumento

**É `InstrumentDefect`, em qualquer fase:**

- violação de qualquer invariante (I1–I10);
- incapacidade de determinar o host de uma requisição;
- falha da captura do corpo;
- exceção de qualquer camada do instrumento: monitor, captura, filtro da transcrição, fidelidade, reconciliação.

**Distinto de `EXEC_EXTERNAL_EFFECT`:** uma requisição com host determinado e fora do endpoint é falha do modelo, registrada e pontuada. Não saber qual é o host é falha do instrumento.

**O que acontece:**

- A falha é registrada pela camada que a detectou e convertida em `InstrumentDefect` ao fim da tentativa, antes da pontuação e de qualquer nova tentativa, como as invariantes da V2.1.
- **Precedência (latch):** a camada da V3 registra o defeito num **estado próprio da tentativa**, independente da exceção que o `fetch` devolve ao Mastra (o Mastra pode embrulhar, trocar ou engolir essa exceção). Depois de **cada** chamada ao Agent (fase 1 e fase 2), a orquestração confere esse estado **antes** de classificar o erro, decidir nova tentativa ou pontuar. Assim, um defeito do instrumento:
  - nunca vira `EXEC_PROVIDER_ERROR`, `EXEC_RATE_LIMIT` nem `EXEC_EXTERNAL_EFFECT`;
  - nunca dispara nova tentativa;
  - com o estado marcado na fase 1, impede a fase 2.
- **A rodada daquele modelo é abortada, e o arquivo de resultados é gravado com o motivo** (camada, fase, turno e tentativa), sem veredito. **A CLI nunca encerra sem registro**, nem quando a falha é uma exceção inesperada.
- A falha não reprova o candidato e não entra no denominador. Corrigir o instrumento depois do congelamento exige novo manifesto e nova rodada.

### Transcrição fiel (I10)

Função nova da V3. O `reconcile` da V2.1 não muda e não serve aqui, porque decide o modo alternativo para a tentativa inteira, e a V3 decide passo a passo.

**Regras comuns às duas comparações:**

- **Entre passos:** a ordem dos passos é preservada. A k-ésima mensagem `assistant` com tool calls corresponde ao k-ésimo passo da fase 1 com emissões.
- **Dentro de um passo, com ids presentes e únicos:** correspondência por `toolCallId`. Chamadas: multiconjunto por id, nome e argumentos canônicos crus (`canonicalJson`). Resultados: multiconjunto por id, nome e conteúdo canônico. **A ordem dos resultados não é exigida** (chamadas paralelas podem ter resultados em ordem diferente da emissão).
- **Dentro de um passo, com id ausente ou duplicado:** **só aquele passo** usa o modo alternativo da V2.1 (multiconjunto por nome + argumentos canônicos crus; resultados por conteúdo canônico). Isso fica registrado como **diagnóstico**, não como violação.
- **Resultados com id duplicado no passo:** a associação de cada resultado a uma chamada não pode ser comprovada. O passo recebe o diagnóstico `RESULT_ASSOCIATION_AMBIGUOUS_DUPLICATE_ID`. **Não há violação quando os multiconjuntos de nomes, argumentos e conteúdos batem**, mas o registro **não afirma** associação individual comprovada.
- **Violação, em qualquer dos modos:** quantidade diferente, nome diferente, argumentos diferentes, resultado diferente, ou id associado ao nome errado.

**Comparação A, captura da fase 1 × transcrição filtrada:** as emissões do `TurnProtocol` de cada passo × os tool calls da mensagem `assistant` correspondente; e cada tool call × o resultado da mensagem `tool` correspondente.

- **Tool de nome desconhecido:** não passa pelos hooks, então não tem evento no `TurnProtocol` nem entra na I3. A I10 confere **emissão × tool call da transcrição × resultado de erro de tool inexistente**, sem exigir evento.
  - emitida e presente na transcrição, com o resultado de erro: fiel, sem violação. Na pontuação, conta em `otherToolCalls` (`SEM_WRONG_TOOL`, regra da V1);
  - emitida e ausente da transcrição (chamada ou resultado): violação.

**Comparação B, transcrição filtrada × requisição real da fase 2:** feita **em memória**, durante a fase 2, sobre a projeção do corpo enviado. **Só booleanos, contagens e diagnósticos são gravados**, nunca o corpo.

- **Fronteira:**
  - Na **primeira requisição da fase 1**, a camada de captura guarda em memória o número `N` de mensagens do corpo, que são a mensagem de sistema e o histórico do caso já serializado, até a entrada do funcionário.
  - Na fase 2, **a transcrição é o sufixo do corpo a partir do índice `N`**.
  - A mensagem de índice `N − 1` tem de ser a `user` do funcionário.
  - **Qualquer mensagem `user` dentro do sufixo é violação.**
  - A fronteira vem do corpo serializado, não da contagem de mensagens do AI SDK: uma mensagem `tool` do histórico com dois resultados vira duas mensagens no corpo.
- **Projeção do sufixo:**
  - mensagens `assistant` com `tool_calls` dão as chamadas: `id`, `function.name` e `function.arguments` decodificado;
  - mensagens `tool` dão os resultados: `tool_call_id` e `content`;
  - o nome de um resultado é o da chamada com o mesmo id;
  - mensagem `assistant` sem `tool_calls` no sufixo é violação.
- **Forma canônica:**
  - argumentos: `JSON.parse` e `canonicalJson`;
  - conteúdo de resultado, que no corpo é string: tenta `JSON.parse` e `canonicalJson`; se não for JSON, compara a string como está;
  - motivo: no levantamento, o corpo da fase 2 trouxe o resultado do `listMyTickets` com as chaves em ordem diferente da do `response.messages`.

## Truncamento

- **Cada fase invocada é classificada individualmente**, pela regra da V2.1 (`contextCheckFromCalls`):
  - passos `retry` e `error` não contam como passos de inferência;
  - passo de inferência sem `usage` observável: fase `UNKNOWN`;
  - nenhuma inferência com `usage` observável: fase `UNKNOWN`;
  - `DETECTED` (acima de 7680), orçamento e suspeita de corte silencioso: regras existentes, sem mudança.
- **Estimativa local de cada fase** (caracteres / 4):
  - **fase 1:** prompt, histórico do caso e schemas das quatro tools;
  - **fase 2:** prompt, histórico do caso, transcrição filtrada e schema de resposta (`interpretationSchema`).
- **A combinação considera só as fases efetivamente invocadas.** Uma fase não executada (por exemplo, a fase 2 omitida porque a fase 1 terminou em `EXEC_*`) **fica fora da combinação** e não recebe `UNKNOWN` artificial. Uma fase **invocada** que não produziu medição é `UNKNOWN`: invocada sem medição não é o mesmo que não executada.
- **Combinação:**
  - qualquer fase invocada em `DETECTED` → turno `DETECTED`;
  - nenhuma em `DETECTED` e alguma em `UNKNOWN` → turno `UNKNOWN`;
  - todas as fases invocadas em `NOT_DETECTED` → turno `NOT_DETECTED`;
  - nenhuma fase com inferência e `usage` observável → turno `UNKNOWN`.

| Fase 1 | Fase 2 | Turno |
| --- | --- | --- |
| `DETECTED` | qualquer, ou não executada | `DETECTED` |
| qualquer | `DETECTED` | `DETECTED` |
| `NOT_DETECTED` | `NOT_DETECTED` | `NOT_DETECTED` |
| `NOT_DETECTED` | **não executada** (fase 1 em `EXEC_*`) | `NOT_DETECTED` |
| `NOT_DETECTED` | `UNKNOWN` (inclusive invocada sem nenhuma inferência medida) | `UNKNOWN` |
| `UNKNOWN` | `NOT_DETECTED`, `UNKNOWN` ou não executada | `UNKNOWN` |

- **Por quê:** preserva a semântica aprovada na V2.1. Um turno cuja fase 1 mediu e depois terminou em erro definitivo fica `NOT_DETECTED`, como no teste (e) da V2.1: o turno continua incorreto por `EXEC_*`, sem uma segunda penalização de truncamento. E uma fase que de fato executou mas não produziu evidência não recebe `NOT_DETECTED`.
- **Maior `inputTokens` reportado do turno:** o maior entre os passos de inferência das fases invocadas. A estimativa e o estado de cada fase ficam no registro.
- **A fase 2 roda mesmo se a fase 1 der `DETECTED`;** a classificação (`EXEC_CONTEXT_TRUNCATED`) vem depois, no `scoreTurn` da V1. A fase 2 só não roda se a fase 1 terminar em `EXEC_*`.
- O requisito continua o da V1: só aprova com os 18 turnos em `NOT_DETECTED`.

## Avaliação de cada resultado

Com o gabarito do caso em `cases.json`. Um turno com `EXEC_*` é incorreto em todas as métricas.

1. **Interpretação válida (Zod):** a interpretação oficial existe e passa no Zod estrito.
2. **Intenção correta:** interpretação válida e `intent` igual ao gabarito.
3. **Tool de negócio correta:** regras da V1 sobre as chamadas de negócio **emitidas na fase 1**.
4. **Entidades e missingFields:** interpretação válida e regras da V1.

- **Vista V1:** os itens acima, o C6 e a chave de estabilidade são calculados pelo `scoreTurn` da V1, sem alteração, sobre uma vista V1 do registro da V3:
  - `businessToolCalls`: tools de negócio emitidas na fase 1, com `rejected` = `validAtCapture` falso (como na V2.1);
  - `otherToolCalls`: nomes desconhecidos emitidos na fase 1 (inclusive `submitInterpretation` ou `json`, se o modelo os inventar). Os tool calls da fase 2 **não** entram;
  - `interpretationRaw`: a interpretação oficial da fase 2 (`null` quando ausente, inválida para o `JSON.parse` ou com `finishReason` `"length"`);
  - `calls`, tokens e latência: das duas fases;
  - `contextCheck`: a combinação da seção "Truncamento";
  - `reasoning`: vazamento no texto das duas fases, nos argumentos da fase 1, na interpretação e no `object` do Mastra;
  - `externalRequests` (o que o monitor registrou nas duas fases), `status` e `execError`: das duas fases.
- **C6:** exige zero tools de negócio na fase 1, além do impacto e da ação esperados (definição da V1).
- **Sem limite de protocolo:** a sequência é garantida pela orquestração e conferida pelas invariantes. **Nenhum evento de submissão é fabricado** na vista V1.
- **Gabaritos e representação:** regras iguais à V1.

## Limites de aprovação

Um candidato é aprovado na V3 se atender a E1–E4, **a rodada não tiver violação de invariante** e todos os limites forem atendidos, calculados pelo `aggregate` da V1 sem alteração:

- interpretação válida pelo Zod: ≥ 17 de 18;
- intenção correta: ≥ 15 de 18 e maioria correta em ≥ 5 de 6 entradas;
- tool de negócio correta: ≥ 15 de 18 e maioria correta em ≥ 5 de 6;
- entidades e missingFields: ≥ 15 de 18;
- estabilidade: mesma intenção e mesmo conjunto de tools de negócio nas 3 repetições em ≥ 4 de 6 entradas, e ≥ 2 concordantes nas demais;
- "Parou tudo!" (C6): as 3 execuções com o impacto e a ação esperados;
- vazamento de raciocínio, truncamento de contexto (só aprova com os 18 em `NOT_DETECTED`) e efeitos externos: zero.

São os limites da V2.1 sem o de protocolo. Uma interpretação inválida ou ausente, ou um turno com `EXEC_*`, não concorda com nenhuma outra.

## Critérios classificatórios

Entre os aprovados, nesta ordem: (1) confiabilidade do contrato: Zod e tool de negócio; (2) qualidade da interpretação; (3) estabilidade; (4) latência mediana do turno (as duas fases); (5) recursos. Desempate: simplicidade para rodar. O spike recomenda; a decisão é do ADR-009.

## Segurança e registros

- **Raciocínio do provider:** descartado e **nunca persistido**, como na V1 e na V2.1. As partes `reasoning` saem da transcrição antes da fase 2, e a I8 confere o corpo.
- **Checagem de vazamento:** na interpretação oficial, no `result.object` (diagnóstico), no texto das duas fases e nos argumentos da fase 1, pela política da V2.1 (`redactToolArgs` para as tools de negócio; regra completa da V1 para a interpretação, para o `object` e para tool desconhecida). Tolerância zero.
- **`result.object` (diagnóstico):** a checagem de vazamento roda sobre o **valor original**, e um marcador encontrado conta como vazamento (`SEM_REASONING_LEAK`), como na interpretação. Antes de gravar, o valor passa por `redactReasoningValue` (V1). **O arquivo grava só a versão redigida.**
- **O que se grava da fase 2:**
  - o texto e a interpretação, depois da remoção de raciocínio;
  - o resultado do Zod e os problemas;
  - o `object` do Mastra, como diagnóstico, **só na versão redigida**;
  - o `finishReason`, e tokens e latência por chamada;
  - o estado do truncamento;
  - booleanos, contagens e diagnósticos da requisição (I4, I8, I10);
  - a contagem e os nomes dos tool calls emitidos.
- **O que não se grava:** o `result.response.body`, o corpo das requisições, a transcrição inteira e os cabeçalhos. Os dados das tools já ficam no `toolLog` da fase 1, como na V2.1.
- **Registros:** sem segredos e sem cabeçalhos (só `retryAfterSeconds`), como na V1.

## Reutilização

**Importar sem cópia, como a V2 fez.** Só módulos cuja importação não tem efeito colateral (a CLI do `../src/run.ts` e a do `../v2/src/run.ts` só rodam com `import.meta.main`). Um teste importa os módulos num processo separado e confere que nada é impresso nem gravado.

| Origem | O que a V3 usa |
| --- | --- |
| `../src/tools.ts` | `createFakeTools`, `TOOL_INPUT_SCHEMAS` |
| `../src/schema.ts` | `interpretationSchema` |
| `../src/prompt.ts` | `SYSTEM_PROMPT`, `PROMPT_VERSION` |
| `../src/models.ts` | `spikeModels` |
| `../src/cases-schema.ts` | `casesFileSchema` |
| `../src/run-record.ts` | `BUSINESS_TOOLS`, `INPUT_TOKEN_BUDGET`, tipos `ExecCode`, `SemCode`, `TurnRecord`, `RateLimitEvent`, `ModelCallRecord`, `ContextCheck` |
| `../src/run.ts` | `MODEL_SETTINGS`, `REASONING_CONTROL`, `ollamaEnvProblem`, `toMessages`, `redactReasoningText`, `redactReasoningValue`, `sanitize`, `withSanitizedConsole`, `classifyError`, `QuotaExhausted` |
| `../src/score.ts` | `scoreTurn`, `aggregate` |
| `../v2/src/protocol.ts` | `TurnProtocol` (sem a `submitInterpretation`) |
| `../v2/src/leak.ts` | `redactToolArgs` |
| `../v2/src/run.ts` | `contextCheckFromCalls`, `verifyManifest` (com o texto deste CRITERIA), `withRequestMonitor`, `ollamaDigest`, `providerOf`, `allowedHostsOf`, `MAX_STEPS`, `TURN_TIMEOUT_MS`, `MAX_ATTEMPTS` |
| `../v2/src/score.ts` | `reconcile` (I3), `canonicalJson` (I10) |

- **Monitor de requisições, em duas camadas:**
  - **V2.1, sem mudança:** o `withRequestMonitor` registra os hosts nas duas fases, sem bloquear.
  - **V3, camada de captura:** instalada **por cima** do wrapper da V2.1 e **envolve as duas fases**. Ela **delega** ao wrapper da V2.1 (não o substitui), de modo que toda requisição passa pelas duas camadas: captura da V3 → monitor da V2.1 → `fetch` original. Ela não altera nem bloqueia a requisição.
    - **Fase 1:** verifica se o host de cada requisição é determinável. Não captura o corpo; a única leitura é a contagem de mensagens da primeira requisição (o índice `N` da I10-B), guardada em memória.
    - **Fase 2:** verifica o host e lê o corpo, em memória, para I4, I8 e a comparação B da I10.
  - **Restauração:** cada camada restaura o `globalThis.fetch` que encontrou, em `finally`, também quando falha.
  - **Host indeterminado, em qualquer fase:** a camada da V3 vê a requisição primeiro e registra a falha do instrumento. O resultado é `InstrumentDefect` (seção "Falha do instrumento"), e a rodada é abortada **antes** de o registro de "externa" que o monitor da V2.1 faz, sem mudança, chegar à pontuação.
- **Os arquivos importados da V2.1 entram no manifesto da V3 com o hash da V2.1.**
- **Reescrito na V3**, porque não pode ser importado: a orquestração das duas fases, o laço de novas tentativas (`runTurn` da V2.1 está preso ao registro da V2), o orçamento de tempo compartilhado, a captura do corpo, as invariantes da V3, a transcrição e a fidelidade, a leitura crua, a estimativa de tokens por fase, a combinação do truncamento, a vista V1, o aquecimento e o resumo.

## Plano de testes com o dublê (antes do congelamento)

Sem modelo real, com o `MastraLanguageModelV2Mock` e respostas HTTP fabricadas pelo caminho real do Ollama (model router).

### Invariantes: um teste positivo e um negativo para cada

Em cada linha, o caso positivo não dispara a invariante, e o negativo dispara (aborta a rodada, com o registro indicando a invariante e o turno).

| # | Positivo (não dispara) | Negativo (dispara) |
| --- | --- | --- |
| I1 | Chunks de cada passo antes do primeiro `beforeToolCall` | Chunk `tool-call` depois do selo (`doStream` com atraso, como na V2.1) |
| I2 | Fase 1 com 5 passos de inferência e passos `retry` entre eles | Registro fabricado com 6 passos de inferência na fase 1 |
| I3 | Fase 1 com uma chamada recusada pela validação (`MASTRA_REFUSED`) e uma executada: reconciliação limpa | Execução sem emissão; `toolLog` com argumentos divergentes; `MASTRA_REFUSED` com `validAtCapture` verdadeiro |
| I4 | Fase 2 sem `tools`, sem `tool_choice`, com `response_format`, em todas as requisições (inclusive as repetidas pelo Mastra depois de um 500) | Corpo com `tools`; corpo sem `response_format`; requisição da fase 2 não capturada ou com corpo ilegível |
| I5 | Fase 2 com `retry` seguido de um passo de inferência | Registro fabricado com dois passos de inferência na fase 2 |
| I6 | Fase 2 com tool call emitido: nada executa, `toolLog` estável | Registro fabricado com execução ou `toolLog` crescendo durante a fase 2 |
| I7 | Fase 1 concluída → uma fase 2; fase 1 em `EXEC_*` → nenhuma | Fase 2 ausente depois de fase 1 concluída; fase 2 presente depois de fase 1 em `EXEC_*`; fase 2 duas vezes |
| I8 | Fase 1 com parte `reasoning`, filtrada: corpo da fase 2 sem `reasoning_content` | Transcrição sem o filtro: corpo com `reasoning_content` |
| I9 | Uma interpretação válida | Registro fabricado com duas interpretações válidas na mesma tentativa |
| I10 | Ver "Transcrição fiel", abaixo | Ver "Transcrição fiel", abaixo |

Também: violação no aquecimento aborta antes dos turnos, e violação numa tentativa anterior (429) também aborta.

### Falha do instrumento

1. Exceção lançada em cada camada (monitor, captura, filtro, fidelidade, reconciliação), numa fase e na outra: `InstrumentDefect`; rodada abortada; **o arquivo de resultados é gravado com o motivo**, sem veredito; a CLI não encerra sem registro.
2. URL de host indeterminado **na fase 1 e na fase 2** (um teste para cada fase): `InstrumentDefect`, e não `EXEC_EXTERNAL_EFFECT`; rodada abortada; arquivo de resultados gravado com o motivo; o registro de "externa" do monitor da V2.1 não chega à pontuação.
3. Exceção inesperada fora das camadas, durante a rodada: o arquivo de resultados também é gravado, com o motivo.
4. **Precedência (latch)**, um teste para cada fase. Uma exceção da camada da V3 chega ao Mastra pelo `fetch`, e o Mastra a embrulha num erro próprio (inclusive um com `statusCode`, que sem o latch seria classificado como `EXEC_PROVIDER_ERROR` ou `EXEC_RATE_LIMIT`). Resultado esperado:
   - `InstrumentDefect` preservado, nunca um `EXEC_*`;
   - nenhuma nova tentativa, mesmo quando o erro embrulhado tem forma de 429;
   - defeito na fase 1: a fase 2 não roda;
   - rodada abortada e arquivo de resultados gravado com o motivo;
   - `globalThis.fetch` original restaurado (`finally`).

### Transcrição e transcrição fiel (I10)

1. **Filtro:** parte `reasoning` removida; texto final excluído; recusa de validação do Mastra mantida; resultado de tool desconhecida mantido; a conversa da fase 2 termina em `tool` ou `user`; fase 1 sem tool resulta em transcrição vazia.
2. **Texto intermediário com duas chamadas paralelas:** a mensagem `assistant` com texto e duas chamadas no mesmo passo é preservada inteira (só o raciocínio sai), e a última mensagem `assistant` sem tool call é excluída.
3. **Comparação A, positivos:**
   - duas chamadas paralelas no mesmo passo, com os resultados em ordem invertida: fiel, sem violação;
   - ids duplicados no mesmo passo, com correspondência correta: diagnóstico `RESULT_ASSOCIATION_AMBIGUOUS_DUPLICATE_ID`, sem violação;
   - id ausente num passo e presente nos outros: só aquele passo no modo alternativo;
   - tool desconhecida emitida, com o resultado de erro na transcrição: sem violação, e contada em `otherToolCalls`.
4. **Comparação A, negativos:** id associado ao nome errado; quantidade divergente; argumentos divergentes; resultado divergente; ordem de passos trocada; tool desconhecida emitida e ausente da transcrição.
5. **Comparação B, positivos:**
   - corpo serializado pelo caminho real (model router), com as chaves dos resultados em outra ordem: fiel;
   - corpo com ids duplicados num passo e correspondência correta: diagnóstico;
   - resultado cujo conteúdo não é JSON: comparado como string, fiel quando igual;
   - **fronteira:** C5 (histórico com mensagens de tool de um turno anterior): fiel; histórico **fabricado** com uma mensagem `tool` de dois resultados, serializada como duas mensagens (nenhum dos seis casos tem): fronteira correta.
6. **Comparação B, negativos:**
   - corpo serializado com id, nome, argumento ou resultado divergente da transcrição: violação;
   - mensagem `assistant` sem `tool_calls` no sufixo: violação;
   - mensagem `user` inserida dentro do sufixo: violação;
   - mensagem de índice `N − 1` que não é a `user` do funcionário: violação.

### Fase 2, falhas e leitura crua

1. **Requisição da fase 2:** só a mensagem de sistema e a conversa, sem texto injetado pelo Mastra.
2. **Tool call na fase 2:** uma requisição só (`maxSteps: 1`); diagnóstico; `SEM_INVALID_INTERPRETATION` sem interpretação válida; nunca `SEM_WRONG_TOOL`.
3. **Leitura crua**, com a coluna do `object` do Mastra ao lado:
   - JSON válido: válido nos dois;
   - cerca ```` ```json ````, prosa + JSON e JSON sem a última chave: o Mastra aceita, e o oficial dá `SEM_INVALID_INTERPRETATION`;
   - campo extra e `null` em opcional: recusados nos dois;
   - texto vazio;
   - `finishReason` `"length"` com JSON aparentemente completo: `SEM_INVALID_INTERPRETATION`.
4. **`errorStrategy: "warn"`:** nenhuma exceção; `text` preservado quando a validação do Mastra recusa.
5. **`result.object` com raciocínio:** marcador de raciocínio num valor do `object` (por exemplo, `entities.problem` com `<think>`): vazamento detectado (`SEM_REASONING_LEAK`), e o marcador ausente do arquivo de resultados.
5. **Fase 1 em `EXEC_*`** (tool seguida de 401): a fase 2 não roda, e o turno fica `EXEC_PROVIDER_ERROR`.
6. **Fase 2 em `EXEC_*`** (500 persistente; 401): `EXEC_PROVIDER_ERROR`.

### Truncamento

1. **Obrigatório:** fase 1 com uma inferência medida, seguida de erro definitivo; fase 2 não executada → combinado `NOT_DETECTED`; o turno continua incorreto por `EXEC_*`.
2. **Adicional:** fase 1 em `NOT_DETECTED`; fase 2 invocada que falha antes de qualquer inferência com `usage` (500 persistente: `retry`, `retry`, `error`) → turno `UNKNOWN`.
3. Cada linha da tabela de combinação; fase 1 `DETECTED` com a fase 2 executada; nenhuma fase com inferência medida → `UNKNOWN`.
4. Estimativa de cada fase; passos `retry` e `error` excluídos; maior `inputTokens` do turno entre as fases invocadas.

### Execução, tempo e monitor

1. **429 na fase 2:** o turno inteiro é repetido; a tentativa anterior guarda as duas fases e passa pelas invariantes.
2. **Cota diária esgotada:** terminal; turnos restantes não executados, sem requisição.
3. **Tempo compartilhado:** a fase 1 consome parte do orçamento, e a fase 2 recebe o mesmo sinal, que não reinicia (estouro na fase 2 dá `EXEC_TIMEOUT`); uma nova tentativa por 429 começa um orçamento novo.
4. **Host fora do endpoint**, numa fase e na outra: registrado pelo monitor, sem bloqueio; o turno recebe `EXEC_EXTERNAL_EFFECT`; a rodada **não** é abortada.
5. **Monitor duplo:**
   - a mesma requisição é observada pelas duas camadas (captura da V3 e monitor da V2.1), inclusive uma para host não permitido, que é registrada sem bloqueio;
   - depois da tentativa, e também depois de uma exceção numa das camadas, o `globalThis.fetch` é o original.

### Pontuação e identidade

1. **Vista V1:** `scoreTurn` e `aggregate` da V1 sem alteração; C6 com zero tools de negócio na fase 1; tool call da fase 2 fora da métrica de tool; nenhum evento de submissão na vista.
2. **Identidade:**
   - SHA-256 dos arquivos importados iguais aos dos manifestos da V1 e da V2.1;
   - o prompt das duas fases é o objeto `SYSTEM_PROMPT` da V1;
   - `maxSteps`, tempo limite e tentativas iguais aos da V1;
   - uma única tabela de manifesto ativa neste arquivo.
3. **Manifesto = fecho de imports:** o fecho das importações relativas a partir dos arquivos da V3 (código e testes) é igual à lista de código do manifesto. Um módulo carregado e fora do manifesto, ou listado e não carregado, reprova.
4. **Importação sem efeito colateral** dos módulos da V1 e da V2.1.
5. **Digest do Ollama** (resposta fabricada de `/api/tags`).

## Sondagens Q1 e Q2 (aprovadas)

**Com os dois modelos, durante a implementação e antes do congelamento**, com entradas próprias, fora dos seis casos. O script fica **fora do manifesto**, e os resultados vão para `v3/results/probes/`. São **diagnósticas**: não pontuam e não aprovam nada.

| # | Pergunta | Por quê |
| --- | --- | --- |
| Q1 | O Ollama aceita o `response_format` da fase 2 e devolve JSON puro no `content`? | A leitura crua não tolera cerca nem prosa |
| Q2 | O Ollama aceita mensagens `assistant` com `tool_calls` e mensagens `tool` numa requisição sem `tools` declaradas? | É a forma da fase 2 sempre que a fase 1 chama tool |

**Se a Q2 mostrar que o Ollama recusa a forma da fase 2, o desenho é revisto antes de congelar.**

**Resultado (2026-11-14): Q1 e Q2 positivas nos dois modelos.** Arquivos em `v3/results/probes/`.

| Rodada | Modelo | Q1 e Q2a (fase 2 isolada) | Q2b (turno completo) | Código da V3 |
| --- | --- | --- | --- | --- |
| 13:49 | `qwen3:4b-instruct` | 5/5 com HTTP 200, JSON puro (sem cerca nem prosa) e Zod válido; Q2a com mensagem `tool` e sem `tools` declaradas | 2/2 concluídos, Q2 exercitada, Zod válido, sem invariante violada nem falha do instrumento | **o congelado**: o SHA-256 dos 6 arquivos de código de `v3/src/` registrado na sondagem é igual ao da tabela |
| 13:50 | `qwen3:8b` | idem | idem | **o congelado** (idem) |
| 13:22 | `qwen3:4b-instruct` | idem | idem | **anterior** aos dois últimos ajustes (item 10 de "Ajustes da implementação": delimitação dos passos pelas requisições e identificação da requisição de inferência pelo endpoint); diverge em `phase2.ts`, `record.ts`, `run.ts` e `test-helpers.ts` |
| 13:23 | `qwen3:8b` | idem | idem | **anterior** (idem) |

O registro da sondagem guarda o SHA-256 do código de `v3/src/` (sem os testes). Os arquivos importados da V1 e da V2.1 são os dos manifestos deles, sem mudança. O script da sondagem (`v3/probe/`) fica fora do manifesto.

## Riscos e limitações declaradas

- **Prefill:** uma conversa que termina em `assistant` pode ser tratada pelo servidor como resposta a continuar. É mitigado ao excluir o texto final da fase 1, e não foi medido com modelo real.
- **Reparo de JSON pelo Mastra:** o `object` do Mastra aceita JSON truncado, cercado ou cercado de prosa. É o motivo da leitura crua. A V3 é mais estrita que a V1 nesse ponto, e a comparação V1 × V3 do Zod deve ler a coluna de diagnóstico.
- **Groq e validação estrita de schema:** registrado, fora da V3. Na sondagem da V2.1 (`v2/results/probes/groq-openai-gpt-oss-120b-2026-11-13T12-25-30-300Z.jsonl`), o Groq recusou com HTTP 400 os argumentos de uma tool cujo schema tem propriedades opcionais (`missing properties: 'problem', 'category', 'operatingSystem', 'impact'`). Na fase 2, o `@ai-sdk/groq` mandaria `response_format` com `strict: true` sobre o mesmo schema. Não foi medido e não será adaptado.
- **Prompt com regras de tools na fase 2:** o prompt da V1 descreve tools que a fase 2 não tem. A ausência de tools e o `response_format` impedem a execução; um tool call vira diagnóstico.
- **Sem instrução de interpretação na fase 2:** a fase 2 depende do `response_format` para entender que deve interpretar o último turno do funcionário.
- **Texto intermediário na fase 2:** o texto que acompanha os tool calls entra na fase 2. Ele pode influenciar a interpretação. É o que o modelo produziu na fase 1, e não é avaliado.
- **Texto ao funcionário não avaliado** na V3. O texto final da fase 1 é descartado da fase 2.
- **Validação tolerante do Mastra na fase 1:** continua como na V2.1. A métrica de tool usa o `validAtCapture`.
- **Turno `EXEC_*` sem nenhuma inferência medida continua `UNKNOWN`** (limitação herdada da V2.1): por exemplo, uma fase 1 cujo único passo é `error`. Pela regra dos 18 em `NOT_DETECTED`, isso deixa o requisito de truncamento inconclusivo. Não se imputa `NOT_DETECTED` sem evidência.
- **Fase 2 invocada sem medição:** uma fase 2 que falha antes de qualquer inferência com `usage` (por exemplo, 500 persistente) deixa o turno `UNKNOWN`, mesmo com a fase 1 em `NOT_DETECTED`, com o mesmo efeito sobre o requisito.
- **`proposeTicketUpdate` não coberta; PendingAction única só no papel:** como na V2.1.
- **O manifesto não congela o typecheck**, como na V2.1.

## Decisões da revisão 1 (2026-11-13)

| # | Tema | Decisão |
| --- | --- | --- |
| 1 | Truncamento entre fases | A combinação considera só as fases invocadas; fase não executada fica fora; fase invocada sem medição é `UNKNOWN` |
| 2 | Texto intermediário | A mensagem `assistant` com tool calls é preservada inteira (só o raciocínio sai); a última `assistant` sem tool call é excluída |
| 3 | Reconciliação da fase 1 | Invariante (I3), com o `reconcile` da V2.1 sem cópia |
| 4 | Hosts | Sai das invariantes; registro sem bloqueio e `EXEC_EXTERNAL_EFFECT`, como na V1 e na V2.1; só falha do monitor é defeito (I4) |
| 5 | Tempo limite | 180 s por tentativa, compartilhados pelas duas fases; nova tentativa por 429, orçamento novo |
| 6 | `finishReason` `"length"` | Interpretação oficial `null`, mesmo com JSON aparentemente completo |
| 7 | Sondagens Q1 e Q2 | Aprovadas, com os dois modelos, durante a implementação e antes do congelamento; diagnósticas; Q2 negativa revê o desenho |
| 8 | I10 com a requisição real | Comparação B em memória sobre a projeção do corpo da fase 2; só booleanos, contagens e diagnósticos gravados |
| 9 | Manifesto | Confirmado pela cadeia real de imports; "participa" = carregado na execução ou nos testes |
| 10 | Motivo da V3 | Evidência do 4B na V2.1 acrescentada |

## Decisões dos ajustes finais (2026-11-13)

Resolvem os quatro pontos para revisão da revisão 1.

| # | Tema | Decisão |
| --- | --- | --- |
| 1 | Tool desconhecida (I10-A) | Emissão × tool call × resultado de erro, sem evento no `TurnProtocol` nem entrada na I3; presente na transcrição: fiel e contada em `otherToolCalls`; ausente: violação |
| 2 | Fronteira da transcrição (I10-B) | Índice `N` guardado na primeira requisição da fase 1; transcrição = sufixo do corpo da fase 2 a partir de `N`; `N − 1` é a `user` do funcionário; `user` no sufixo é violação |
| 3 | Monitor duplo | A camada da V3 delega ao wrapper da V2.1, só lê o corpo, e cada camada restaura o `globalThis.fetch` em `finally` |
| 4 | Resultados no corpo | Conteúdo em string: `JSON.parse` + `canonicalJson`, ou a string como está; id duplicado: `RESULT_ASSOCIATION_AMBIGUOUS_DUPLICATE_ID`, sem violação quando os multiconjuntos batem |
| 5 | Falha do instrumento | Host indeterminado, falha de captura ou exceção de qualquer camada, em qualquer fase: `InstrumentDefect`; rodada abortada com o arquivo de resultados gravado com o motivo; distinta de `EXEC_EXTERNAL_EFFECT` |
| 6 | Manifesto | "Fecho previsto"; a confirmação real é o teste do fecho, depois da implementação |
| 7 | E2 | A fase 1 disponibiliza as quatro tools; o modelo as usa conforme o caso; o C6 continua exigindo zero tools de negócio |
| 8 | Host indeterminado (último ajuste) | A camada da V3 envolve as duas fases: na fase 1, só verifica o host (e conta as mensagens da primeira requisição, para o `N`); na fase 2, também lê o corpo. Host indeterminado em qualquer fase: `InstrumentDefect`, antes de o registro de "externa" da V2.1 chegar à pontuação |
| 9 | Precedência do `InstrumentDefect` (latch) | Estado próprio da tentativa, independente da exceção devolvida ao Mastra; conferido depois de cada chamada ao Agent, antes de classificar, repetir ou pontuar; nunca vira `EXEC_*` nem dispara nova tentativa |
| 10 | `result.object` (diagnóstico) | Checagem de vazamento sobre o valor original; gravado só depois de `redactReasoningValue` |

Nenhum ponto para revisão pendente.

## Ajustes da implementação (2026-11-14)

O que mudou em relação ao texto aprovado em 2026-11-13, depois da implementação e da revisão dela. **Onde houver diferença, esta seção prevalece sobre o texto acima.** Nenhuma mudança afeta a V1 nem a V2.1, que continuam sem alteração.

1. **Host indeterminado é bloqueado, não delegado.** A camada da V3 marca o latch e **não delega** a requisição: nem ao monitor da V2.1, nem ao `fetch` original. Por isso o monitor da V2.1 **não** registra essa requisição como externa, o que substitui as frases "O monitor da V2.1 continua registrando a requisição como externa" ("Reutilização") e "o registro de externa do monitor da V2.1" ("Falha do instrumento" e plano de testes). Testes: na fase 1 e na fase 2, `InstrumentDefect`, nenhuma requisição no servidor fabricado, nada em `externalRequests` e, no caso da fase 1, a fase 2 não roda.
2. **Latch bloqueia as requisições seguintes.** Com o latch marcado por qualquer falha do instrumento (host indeterminado, corpo ilegível, exceção da camada, falha do monitor), nenhuma requisição seguinte é delegada, inclusive as repetições internas do Mastra. A requisição recusada lança `InstrumentBlocked` ao Mastra, e a tentativa termina como `InstrumentDefect`.
3. **Monitor injetável e sentinela abaixo dele.** A ordem é: captura da V3 (topo) → monitor → sentinela da V3 (base) → `fetch` original. O monitor é uma dependência injetável só para testes; o padrão é o `withRequestMonitor` da V2.1, sem alteração.
   - Uma exceção que volta ao topo **sem** ter chegado à sentinela é falha do monitor (`InstrumentDefect`), nunca `EXEC_PROVIDER_ERROR`, `EXEC_RATE_LIMIT` ou `EXEC_EXTERNAL_EFFECT`.
   - Um monitor que responde sem delegar ao `fetch` também é falha do monitor.
   - Um erro que chegou à sentinela é de rede ou do provider, e segue a classificação da V1 (`EXEC_*`).
   - Uma exceção que escapa do próprio monitor, fora de uma requisição, também é falha do monitor.
4. **I4 por contagem total.** Na fase 2, as requisições capturadas são **iguais ao total de passos** (todos os `finishReason`: inferência, `retry` e `error`). A exceção é a fase 2 cancelada por tempo (`finishReason` `"aborted"`): aí, capturas ≥ passos. Substitui a conferência "capturas ≥ passos de inferência". Mesmo quando o `generate` lança (por exemplo, 500 persistente), os passos `retry`/`error` chegam pelo `onStepFinish`, e a igualdade vale. Testes comparam a contagem do servidor fabricado com a da captura: sucesso (1), 500 → `retry` → sucesso (2), 500 persistente (3) e cancelamento (≥).
5. **Cancelamento por tempo.** No Mastra 1.81.0, quando o sinal de cancelamento dispara, o `generate` **não lança**: devolve `finishReason: "aborted"`, sem passos e sem `error` (medido). A V3 trata esse resultado como falha, classificada pelo motivo do sinal (`TimeoutError`) como `EXEC_TIMEOUT`, nas duas fases. O mesmo comportamento existe no caminho da V1 e da V2.1, que não o detectam. Elas não foram alteradas, e as rodadas registradas da V2.1 ficaram muito abaixo dos 180 s.
6. **Exceção de uma camada do instrumento:** fica registrada no latch e é relançada ao Mastra pelo `fetch`, sem delegar a requisição.
7. **Sondagem fora da suíte oficial.** O script e os testes das sondagens Q1 e Q2 ficam em `v3/probe/` (`probe.ts`, `probe.test.ts`), fora do manifesto e fora da suíte oficial (`v3/src/*.test.ts`). Comandos próprios: `node --env-file=.env v3/probe/probe.ts --model "<rótulo>"` e `node --test v3/probe/probe.test.ts`. O fecho de imports da suíte oficial continua com 29 arquivos.
8. **Ganchos só para testes** (`TEST_HOOKS`: `phase2Model`, `timeoutMs`, `fault`, `monitor`, `invariantCheck`). A CLI monta as opções da rodada por `cliRunOptions`, que não contém nenhum gancho, e o cabeçalho da rodada grava `testHooksUsed` (numa rodada real, vazio). Testes provam as duas coisas.
9. **Dublê × HTTP fabricado.** A captura só vê o `fetch`, e o `MastraLanguageModelV2Mock` não passa por ele. Por isso o plano de testes usa respostas HTTP fabricadas pelo caminho real do Ollama, e o dublê só no I1 (atraso de chunks no stream).
10. **`onStepFinish` fora de ordem: passos da fase 1 delimitados pelas requisições.**
    - **Achado.** Na rodada do Groq na V2.1 (2026-11-14, C1, repetição 2), as chamadas foram `0:tool-calls`, `1:retry` (10.012 ms), `2:retry` (1 ms) e `3:tool-calls` (1 ms). O `TurnProtocol` registrou a submissão no passo 1, mas `result.steps` a mostra no índice 3.
    - **Medição** (HTTP fabricado, caminhos do Groq e do model router):
      - Sem cabeçalho de limite de taxa, com 429 ou 500 seguidos de sucesso: os `onStepFinish` chegam em ordem, e o passo do protocolo é igual ao índice.
      - Quando uma resposta traz `x-ratelimit-remaining-tokens` entre 1 e 1999, o Mastra adia em cerca de 10 s **todos os `onStepFinish` seguintes**, mas o laço continua: as requisições e os chunks `tool-call` dos passos seguintes chegam antes. Isso acontece **com ou sem 429/500**.
      - Como o `TurnProtocol` avança o passo no `onStepFinish`, passos distintos se fundem: num roteiro tool → 500 → tool → tool, as duas últimas chamadas ficaram no mesmo passo.
      - Na V3 sem correção, isso deu **falsa I1** (chunk "depois do selo") e **falsa I10** (2 passos com emissões contra 3 na transcrição), e a latência do `retry` subiu para 10.011 ms.
      - Nas sondagens da V2.1, o Groq devolveu o cabeçalho em 4 de 4 respostas, e o Ollama local em 0 de 6 e 0 de 5. A V3, só com Ollama, não fica exposta na prática; a correção é defensiva.
    - **Correção.** A V3 avança o passo do `TurnProtocol` no **início de cada requisição** da fase 1, visto em tempo real pela camada de captura. Uma requisição por passo (inferência, `retry` ou `error`) faz o passo do protocolo coincidir com o índice em `result.steps`. O `TurnProtocol` da V2.1 não muda: a V3 só decide quando chamar o `onStepFinish()` dele. Dois cuidados:
      - **Só a requisição de inferência avança o passo:** o método POST para a URL de inferência do provider da fase (`inferenceEndpointOf`). Também só ela entra na contagem por fase (I4, latência), dá o `N` e tem o corpo lido na fase 2.
        - **Derivação da URL, a partir do código instalado:**
          - Ollama: `createOpenAICompatible({ baseURL: config.url }).chatModel(...)` (`@mastra/core/dist/llm-CSHDOVui.js:8914-8924`) monta `new URL(\`${withoutTrailingSlash(baseURL)}${path}\`)` (`netlify-CAH5VW8O.js:4269-4283`), com `path: "/chat/completions"` no `doGenerate` (`netlify-CAH5VW8O.js:3307-3310`). Resultado: a `url` de `src/models.ts` + `/chat/completions`.
          - Groq: `\`${withoutTrailingSlash(baseURL) ?? "https://api.groq.com/openai/v1"}${path}\`` (`@ai-sdk/groq/dist/index.js:886-897`), com o mesmo `path` (`index.js:453-456`). O modelo expõe essa função em `config.url`, e a V3 a chama.
          - Confirmado nos testes com HTTP fabricado: todas as requisições observadas são POST para a URL derivada, nos caminhos do Ollama e do Groq.
        - **Outra rota no mesmo host permitido** (ex.: `GET /api/tags`): não avança passo e não entra na captura; segue ao monitor da V2.1 como qualquer requisição (host permitido: não é externa).
        - **Host externo:** registrado pelo monitor da V2.1, sem bloqueio (`EXEC_EXTERNAL_EFFECT`).
        - **Testes:**
          - outra rota no mesmo host no meio da fase 1: emissões alinhadas (`0:L1, 1:A1`), capturas = chamadas, sem externa nem defeito;
          - outra rota no mesmo host no meio da fase 2: fora da I4 e da comparação B, sem falsa violação;
          - requisição a host externo no meio da fase 1 e da fase 2: emissões alinhadas, `EXEC_EXTERNAL_EFFECT`, sem defeito;
          - classificação pela camada: só POST para a URL de inferência da fase conta (outro método, outra rota e outro host, não);
          - comprovação: contando toda requisição com host determinado, os testes de outra rota falham, com as emissões deslocadas para `1:L1, 2:A1`.
      - **O último passo da fase 1 é fechado em `finally`**, também quando o `generate` lança. Testes: tool seguida de 401, e tool seguida de 500 persistente (o `generate` lança). Nos dois, a emissão fica no passo 0, há um passo do protocolo por chamada, e nenhuma invariante dispara.
    - **Testes** em `v3/src/provider-path.test.ts`, os dois com o cabeçalho de limite baixo:
      - tool → 500 → tool → tool → texto: emissões nos passos 0, 2 e 3, iguais aos índices; sem chunk atrasado; sem violação;
      - tool → tool → tool → texto, sem erro: passos 0, 1 e 2, sem fusão.
    - **Pontos que supõem "passo do protocolo = índice"** e a robustez de cada um:

      | Ponto | Robusto à troca de ordem? |
      | --- | --- |
      | Passo das emissões, eventos e `steps` do `TurnProtocol` | Não, pelo `onStepFinish`; **sim**, com a correção |
      | I1 (chunk depois do selo) | Não (falsa I1); **sim**, com a correção |
      | I10-A (emissões agrupadas por passo) | Não (falsa I10); **sim**, com a correção |
      | I3 (chave passo + id) | Sim: emissões e eventos usam o mesmo contador. Num passo fundido com ids repetidos, iria ao modo alternativo; não vai mais, com a correção |
      | I2, I4, I5, I7, I9 (contagens de `result.steps` e da captura) | Sim |
      | I10-B (transcrição × corpo) | Sim: não usa o passo do protocolo |
      | Vista V1 (ordem global das emissões) e C6 | Sim |
      | Truncamento (`usage` por índice em `result.steps`) | Sim |
      | Latência por chamada (pelos `onStepFinish`) | Não; corrigido no item 11 |
      | Sondagens (Q2b usa o registro da V3) | Herdam a correção |
11. **Latência por chamada pelas requisições.** Com uma requisição por passo, a latência de cada chamada vai do início da sua requisição ao início da próxima (inclui a execução das tools e a espera de nova tentativa); no último passo, vai até o fim da resposta. Sem essa correspondência, continua a medida pelos `onStepFinish`. Só a latência do turno entra nos critérios classificatórios.
12. **Limitação da V2.1 (não corrigida; Groq fora da aprovação).** O `TurnProtocol` da V2.1 avança o passo no `onStepFinish`. Com a pausa de limite de taxa:
    - a I1 da V2.1, que confere `calls` com índice maior que o passo de término, acusa falsamente gerações depois do aceite quando as novas tentativas internas são avisadas fora de ordem. Foi o que abortou a rodada do Groq de 2026-11-14 (C1, repetição 2);
    - passos distintos podem se fundir, e a guarda de passo pode tratar como do mesmo passo chamadas que o modelo emitiu em passos diferentes.

## Ordem de trabalho

1. Critérios → revisão e aprovação (feita em 2026-11-13).
2. Implementação e testes com o dublê; **sondagens Q1 e Q2** com os dois modelos (diagnósticas) → revisão (feitas; Q1 e Q2 positivas em 2026-11-14).
3. Manifesto (gravado em 2026-11-14) e commit de congelamento.
4. Rodadas: `qwen3:4b-instruct`, depois `qwen3:8b`.

## Arquivos (manifesto)

**Congelado em 2026-11-14** (fins de linha LF, como fixa o `.gitattributes` da raiz). 33 arquivos: os 29 do fecho de imports e mais `cases.json`, `package.json`, `package-lock.json` e `.npmrc`. A tabela está no fim desta seção.

**Critério:** participa do manifesto todo arquivo **carregado na execução ou nos testes** da V3.

**Fecho previsto e confirmado:** calculado em 2026-11-13 pelo fecho estático das importações relativas, a partir do que a V3 **prevê** importar (`src/tools.ts`, `src/schema.ts`, `src/prompt.ts`, `src/models.ts`, `src/cases-schema.ts`, `src/run-record.ts`, `src/run.ts`, `src/score.ts`, `v2/src/protocol.ts`, `v2/src/leak.ts`, `v2/src/run.ts`, `v2/src/score.ts`). O fecho previsto tem 15 arquivos de código: os 12 de partida, mais `src/fixtures.ts` (pelas tools e pelo score da V1) e `v2/src/prompt.ts` e `v2/src/record.ts` (o `protocol.ts` importa os dois).

**Confirmação:** o teste do fecho (`identity.test.ts`, "manifesto da V3") refaz o fecho a partir dos arquivos de `v3/src/` (código e testes), confere que ele é igual ao código da tabela gravada (29 arquivos) e que o resto da tabela é `cases.json`, `package.json`, `package-lock.json` e `.npmrc`. Também confere que os 19 arquivos herdados têm na tabela da V3 o mesmo SHA-256 dos manifestos da V1 e da V2.1.

- **Da V1, importados sem cópia, com o hash do manifesto da V1:** `src/prompt.ts`, `src/schema.ts`, `src/models.ts`, `src/fixtures.ts`, `src/tools.ts`, `src/cases-schema.ts`, `cases.json` (lido na execução), `package.json`, `package-lock.json`, `.npmrc` (versões das dependências).
- **Da V1, fora do manifesto da V1, idênticos ao commit `2182d6b`:** `src/run-record.ts`, `src/run.ts`, `src/score.ts`.
- **Da V2.1, importados sem cópia, com o hash do manifesto da V2.1:** `v2/src/protocol.ts`, `v2/src/leak.ts`, `v2/src/run.ts`, `v2/src/score.ts`, `v2/src/record.ts`, `v2/src/prompt.ts`.
- **Novos:**
  - código: `v3/src/record.ts`, `v3/src/transcript.ts` (filtro e fidelidade), `v3/src/phase2.ts` (leitura crua, classificação e captura do corpo), `v3/src/score.ts` (vista V1, truncamento combinado e invariantes), `v3/src/run.ts` (orquestração, tempo, novas tentativas e CLI), `v3/src/test-helpers.ts`;
  - testes: `transcript.test.ts`, `phase2.test.ts`, `provider-path.test.ts`, `invariants.test.ts`, `score.test.ts`, `retry.test.ts`, `context-check.test.ts`, `identity.test.ts`.
- **Não entram:** os arquivos de teste da V2.1 (inclusive `v2/src/test-helpers.ts`). Os testes da V3 não os importam; se algum passar a importar, o teste do fecho exige que entre no manifesto.
- **Não entra `v2/CRITERIA.md`:** o `verifyManifest` da V2.1 só o lê pelo valor padrão, e a V3 passa o próprio texto.
- **Fora:** este arquivo, o `v3/README.md`, os `tsconfig`, o `src/check-cases.ts` e a pasta `v3/probe/` (script e testes das sondagens Q1 e Q2), como na V2.1.

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
| `v2/src/protocol.ts` | `d4012db65e215f7f75b0820a8249de40956501133a278231901dc0a27eabb6ba` |
| `v2/src/leak.ts` | `88821444d5f250fbbd148c3933fb5728ca561d5e20327320e9929b8983b42213` |
| `v2/src/run.ts` | `5d3504c7ae4a9bb4b278129efe11f3448ed9734013782c72215b2ec18afa7527` |
| `v2/src/score.ts` | `00a90e712c18ad1ee30a006eed81d362c7ee531e2f4a4feb38b112007dc7e13e` |
| `v2/src/record.ts` | `c1d51d4474331eb76a98d08a7a11ca0f23473d72bdb01689826d36867259eb85` |
| `v2/src/prompt.ts` | `00e77722405ef730e2d7ccee78e956692e7c26057b6a1096179f380bb1df7214` |
| `v3/src/record.ts` | `9ded4ba9a245b45003cd53ffa43f11f2d490501015c00cd43cc741f55d4ecdb0` |
| `v3/src/transcript.ts` | `54782ae2ce0191f3b68ae89a65d1b363f070f61fc36c495d005eeee2e540d69f` |
| `v3/src/phase2.ts` | `0d9594b17056210ede32288e3713b25e85a74bd5a7475ed1ea350c916d1b0cbf` |
| `v3/src/score.ts` | `5a4b20df823b1ad797dcffef05382d4ade8a223a2dcb3908c23919e88752355a` |
| `v3/src/run.ts` | `55e035f1d6097230b527a08ad3947b622b4dad7f13ef084183c19ac479005741` |
| `v3/src/test-helpers.ts` | `94a26a2f9119e378d3d29aadc3b5618213031fed07b6704716d8080573fcee5d` |
| `v3/src/context-check.test.ts` | `7d508dbebbdf7be94993e909d660fa0894481ec43b07c00eb24140e906095dec` |
| `v3/src/identity.test.ts` | `b867f866298486c5be7d2797488f8f62c08a542e580ee8645198b572e6d0f550` |
| `v3/src/invariants.test.ts` | `6779f8e126bf321d7aa8d63140d6455597ec61c0dfbde711bfc443106e1b6ff4` |
| `v3/src/phase2.test.ts` | `2612b36801751ab084b66a0c30218e4f0f70f079b6a6d277029abc9f08f95352` |
| `v3/src/provider-path.test.ts` | `e6f44a875810da1c9684bf183600652e936f7b36064308b10dcf4dc421375d29` |
| `v3/src/retry.test.ts` | `da2e012c0fbb76bf4bba5226b8dd1958e25d1cdee8ddf608dc58b5bbb1b921fa` |
| `v3/src/score.test.ts` | `0f8c832481f6034a8d8a6acfdbcbaf57578fc5d12fcecd2d01300d3fa58e5530` |
| `v3/src/transcript.test.ts` | `5f8259f8581cbc5b5abe6b5bfa80918c8715f785c5c8a8badcb9789d61ee2d86` |

Conferência, na pasta `spikes/llm-model/`: `sha256sum -c` sobre as linhas `<hash>  <arquivo>` desta tabela, o `verifyManifestV3()` de `v3/src/run.ts` (o mesmo que a CLI usa) ou o `identity.test.ts` ("manifesto da V3").

**Escopo do manifesto:** congela os **artefatos de execução e de pontuação** (o que roda no turno, o que pontua e o que os testes do dublê exercitam), **não o typecheck**. Este arquivo, o `v3/README.md`, os `tsconfig` e a pasta `v3/probe/` ficam fora. A CLI da V3 só executa com a tabela presente e todos os hashes iguais.
