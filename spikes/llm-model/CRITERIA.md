# Spike do ADR-009: protocolo e limites de aprovação

**Estado: congelado em 2026-11-11**, antes de qualquer execução de modelo. Mudar este protocolo, os casos, o prompt, as tools ou as fixtures invalida a comparação entre modelos; os SHA-256 da seção "Arquivos" conferem o congelamento.

## Não é baseline

**Ainda não existe baseline oficial.** Este spike é um experimento de seleção de modelo para o ADR-009, e seus resultados **não constituem baseline**. A primeira execução da avaliação completa (o conjunto de cenários de `docs/evaluation/01-evaluation-scenarios.md`), depois da decisão do ADR-009, será o baseline oficial (README §10, "Baseline primeiro"; cenários §1 e §6).

## Requisitos eliminatórios (E1 a E4)

Um provider ou modelo só é candidato se atender aos quatro. Eles são verificados antes dos limites de aprovação; o typecheck da Fase 1 não comprova nenhum deles.

- **E1. Custo zero.** Uso sem pagamento, sem cartão de crédito cadastrado e sem depender de créditos promocionais.
- **E2. Mastra e contrato funcional.** O modelo roda dentro do agent Mastra (README §2) e, no mesmo fluxo de um turno, entrega a interpretação estruturada (DM §3.12, `src/schema.ts`) e chama as tools de negócio. Verificado em execução, na Fase 2. O typecheck só confere a forma da configuração e das tools (`src/models.ts`, `src/tools.ts`).
- **E3. Termos de uso aceitáveis para dados fictícios.** Os termos do provider precisam ser aceitáveis para os dados do projeto, que são fictícios (cenários §2: "sem dados reais"). **Limite:** dados reais de funcionários ou chamados não podem ser enviados a um provider externo sem uma decisão registrada; nenhum documento do projeto autoriza isso hoje. Um modelo local mantém os dados na máquina.
- **E4. Cota gratuita comporta uma avaliação completa por dia.** A cota gratuita diária do provider precisa caber **uma avaliação completa do projeto** (o conjunto de cenários de `docs/evaluation/01-evaluation-scenarios.md`) por dia, em execução sequencial, sem pagamento. Estimativa pessimista (detalhes abaixo): **≈ 65 turnos**, **até 195 chamadas ao modelo** e **até 1,5 milhão de tokens de entrada e 100 mil de saída**. Os limites do provider (requisições por dia, tokens por dia, tokens e requisições por minuto) são lidos na Fase 2, no painel do provider e nos cabeçalhos de limite das respostas; este documento não presume valores. Modelo local: E4 atendido por definição (sem cota).

### Estimativa do E4

Turnos com LLM por cenário, pelas entradas e fixtures dos cenários. Os estados de conversa montados "por turnos de roteiro" entram com a quantidade estimada de turnos de montagem:

| Cenários | Turnos estimados |
| --- | --- |
| SC-01, SC-02, SC-04, SC-05, SC-10, SC-12 | 1 cada (6) |
| SC-06, SC-09, SC-11, SC-15, SC-19 (casos A e B) | 2 cada (10) |
| SC-03 | 4 (relato + 3 respostas de coleta) |
| SC-08 (casos A e B) | 5 (pedido + 3 respostas + 1 edição) |
| SC-07 | 6 (relato + coleta + resposta sobre o candidato + informação adicional) |
| SC-13, SC-16, SC-17 | 5, 4 e 4 (montagem do rascunho + turno avaliado; no SC-16 e no SC-17 a confirmação é clique) |
| SC-14 | 6 (montagem de CONV-OP-PROCESSING + turno avaliado) |
| SC-18 (casos A e B) | 10 (relato + coleta + resposta, em cada caso) |
| SC-20 | 3 (montagem de CONV-FOCUS-A1 + turno avaliado) |
| **Total** | **≈ 63, arredondado para 65** |

- **Chamadas ao modelo por turno:** 1 (sem tool) a 3 (passo da tool, resposta final e, se houver, chamada de estruturação). Média estimada 2, pessimista 3: **≈ 130 a 195 chamadas**.
- **Tokens por chamada:** entrada limitada a 7680 (prompt, tools e histórico); média estimada de 3000. Saída limitada a 512; média estimada de 250. Entrada: ≈ 390 mil (média) a ≈ 1,5 milhão (pessimista, 195 × 7680). Saída: ≈ 33 mil (média) a ≈ 100 mil (pessimista, 195 × 512).
- O E4 exige que a cota caiba a **estimativa pessimista**. Os valores são estimativas para dimensionar a cota, não medições.

### Groq contra o E4

Fotografia dos limites da cota gratuita do `openai/gpt-oss-120b`, lidos no painel do Groq pelo autor em 2026-11-09: **30 RPM, 1.000 RPD, 8.000 TPM, 200.000 TPD**.

| Limite | Valor lido | Necessidade estimada | Atende? |
| --- | --- | --- | --- |
| Requisições por dia (RPD) | 1.000 | até 195 chamadas | Sim |
| Requisições por minuto (RPM) | 30 | execução sequencial | Sim |
| Tokens por dia (TPD) | 200.000 | ≈ 1,6 milhão (≈ 1,5 milhão de entrada + ≈ 100 mil de saída, pessimista); ≈ 420 mil na média | **Não** |
| Tokens por minuto (TPM) | 8.000 | uma chamada no limite configurado soma 8.192 tokens (7.680 de entrada + 512 de saída) | **Não** no pior caso [Inferência] |

**Conclusão: o Groq NÃO atende ao E4** com esses limites: a cota diária de tokens comporta menos de um oitavo da estimativa pessimista e menos da metade da média. O `openai/gpt-oss-120b` segue **só como referência**, fora da aprovação de candidatos. A reconsulta da cota continua como verificação da Fase 2 (os limites podem mudar).

## Modelos

| Papel | Caminho | Modelo | Aprovação |
| --- | --- | --- | --- |
| Principal | Ollama, endpoint compatível com OpenAI pelo model router do Mastra (`src/models.ts`) | `qwen3:4b-instruct` | Candidato, avaliado contra os limites abaixo |
| Comparação | Ollama, mesmo caminho | `qwen3:8b` | Candidato, avaliado contra os limites abaixo |
| Referência | Groq (`@ai-sdk/groq`) | `openai/gpt-oss-120b` | **Referência pontual, fora da aprovação de candidatos enquanto não atender ao E4** (não atende com os limites lidos em 2026-11-09; ver "Groq contra o E4") |

Para cada modelo Ollama, registrar o digest da imagem usada (`ollama show` ou `/api/tags`).

**Pendências da Fase 2, por provider** (detalhes no README do spike): se o `seed` chega ao modelo; se o limite de saída é aplicado; como controlar o raciocínio pelo caminho usado; e o `tool_choice`, cujo suporte o endpoint compatível com OpenAI do Ollama não declara. O E2 não está aprovado: o typecheck só confere a forma da configuração.

## Configuração

- **3 repetições** de cada caso, em **sessões independentes**: agent novo, tools novas (`createFakeTools()`), sem memória entre repetições. O único contexto é o histórico gravado do caso.
- **Prompt de sistema:** `src/prompt.ts`, **idêntico para os três modelos, sem ajuste por modelo**: nenhuma instrução específica de um modelo (por exemplo, `/no_think`) entra no prompt nem nas mensagens.
- **Temperatura 0** e **seed 42** (`modelSettings`) quando o provider suportar; quando não suportar, registrar **N/A** para o parâmetro.
- **Contexto no Ollama:** o servidor roda com `OLLAMA_CONTEXT_LENGTH=8192`, conferido na coluna `CONTEXT` do `ollama ps` antes de cada execução (o endpoint compatível com OpenAI não recebe `num_ctx`).
- **Entrada máxima** de 7680 tokens; **saída máxima** de 512 tokens (`maxOutputTokens`). Se o limite de saída não for aplicado pelo provider, registrar.
- **Prompt, tools, fixtures e casos idênticos** entre modelos: os hashes da seção "Arquivos" são registrados em cada execução.
- **Raciocínio do provider:** descartado e **nunca persistido**. Onde o caminho usado oferecer um parâmetro para desligá-lo, ele é desligado por esse parâmetro, nunca pelo prompt. Onde vier separado (partes de raciocínio, campo de raciocínio), é removido antes de qualquer gravação. **Se um modelo não permitir desligar o raciocínio pelo caminho usado, isso é um resultado registrado, e o raciocínio que aparecer na interpretação, no texto final ou em dado persistido conta como vazamento** (`SEM_REASONING_LEAK`, tolerância zero).
- **Groq:** execução **sequencial**; respeitar `Retry-After`; registrar cada resposta 429 (instante e cabeçalhos de limite); **até 3 tentativas por turno**; **parar** se a cota diária acabar.

## Histórico gravado

Casos com estado ou com vários turnos (C4 e C5) trazem os turnos anteriores em `history` (usuário e assistente; no assistente, chamadas de tool gravadas, com argumentos válidos e o resultado que a tool falsa devolveria). O histórico é fixo, idêntico em todas as repetições e modelos, e **nenhum turno é condensado numa mensagem**. Cada histórico tem a fonte e as diferenças em relação ao cenário em `derivation` e `justification`.

- **Só o turno `input` é avaliado.** A interpretação avaliada extrai as entidades **do turno atual**, com o histórico como contexto (o backend acumula o `collectedData` turno a turno, AF §2).
- **`state`** declara, em cada caso, o estado da conversa que o histórico representa no turno avaliado: estado da conversa (DM §8.1), `PendingAction` aberta (DM §3.13) e chamado em foco (DM §3.5). O `state` **não é enviado ao modelo**, que só vê as mensagens.
  - **Verificado pelo `check:cases` contra o histórico:** a `pendingAction`. Se presente, `id`, `version` e `status` são iguais ao resultado da última `proposeTicketDraft` gravada, e o `type` é `CREATE_TICKET`, porque a proposta vem da `proposeTicketDraft`. Se `null`, o histórico não pode ter proposta gravada.
  - **Metadado do cenário, sem verificação pelo histórico:** `conversationStatus` e `focusTicketId`. As mensagens não têm como mostrá-los; os valores vêm da fixture do cenário (C5: `CONV-DRAFT-OPEN`) ou de uma conversa nova (`AI_ACTIVE`, sem foco).

## Unidade de medida

- **Resultado = um turno completo do agent**: da entrada do funcionário até a interpretação final, incluindo todas as chamadas internas (passos de tool, chamada de estruturação, novas tentativas). Não é uma chamada individual à API.
- **Denominador fixo: 18 resultados por modelo** (6 casos × 3 repetições). Nenhum resultado é descartado.
- **Consumo e latência:** registrar a latência do turno e, separadamente, tokens de entrada e saída e a latência de cada chamada interna.

## Erros: semânticos e de execução

Toda falha registra o grupo e um ou mais motivos. Os dois grupos ficam no denominador de 18.

**Erro de execução** (o turno não se completou ou o ambiente falhou): incorreto em **todas** as métricas.

| Motivo | Quando |
| --- | --- |
| `EXEC_PROVIDER_ERROR` | Erro do provider ou de rede ao chamar o modelo |
| `EXEC_TIMEOUT` | Tempo esgotado |
| `EXEC_RATE_LIMIT` | 429 depois do limite de tentativas |
| `EXEC_QUOTA` | Cota diária esgotada; o turno não foi executado |
| `EXEC_FRAMEWORK` | Exceção do Mastra ou do código do spike |
| `EXEC_CONTEXT_TRUNCATED` | Entrada acima de 7680 tokens ou cortada pelo provider (tolerância zero) |
| `EXEC_EXTERNAL_EFFECT` | Chamada de rede que não seja ao endpoint do modelo, ou escrita fora do registro das tools falsas (tolerância zero) |

**Erro semântico** (o turno se completou e a resposta está errada): incorreto só na métrica afetada.

| Motivo | Métrica afetada |
| --- | --- |
| `SEM_INVALID_INTERPRETATION` | Interpretação inválida pelo Zod: intenção e entidades/missingFields (a tool é julgada pelas chamadas feitas) |
| `SEM_WRONG_INTENT` | Intenção |
| `SEM_WRONG_TOOL` | Tool: tool diferente, tool chamada quando o esperado é "nenhuma", ou tool esperada não chamada |
| `SEM_WRONG_TOOL_ARGS` | Tool: argumento fora da regra, argumento proibido ou chamada recusada pela validação |
| `SEM_WRONG_ENTITIES` | Entidades/missingFields |
| `SEM_WRONG_MISSING_FIELDS` | Entidades/missingFields |
| `SEM_REASONING_LEAK` | Raciocínio do modelo na interpretação, no texto final ou em dado persistido (tolerância zero) |

Um `finishReason` de limite de saída é registrado junto do motivo semântico que ele causar.

## Tools de negócio × tool sintética do Groq

- **Tools de negócio:** as quatro de `src/tools.ts` (`searchArticles`, `listMyTickets`, `proposeTicketDraft`, `requestHandoff`). Só elas contam na métrica de tool.
- **Tool sintética do Groq:** quando há saída estruturada e tools na mesma chamada, o `@ai-sdk/groq` acrescenta uma tool `json` (ou `json_1`, `json_2`… se o nome já existir) cuja entrada é o schema da interpretação. Ela é o **mecanismo de saída estruturada**, não uma tool de negócio: não conta como chamada de tool (nem quando o esperado é "nenhuma"), a interpretação é lida dela, e ela entra no consumo e na latência. Chamadas de estruturação do próprio Mastra seguem a mesma regra.
- Qualquer outro nome de tool chamado pelo modelo conta como tool incorreta (`SEM_WRONG_TOOL`).

## Avaliação de cada resultado

Com o gabarito do caso em `cases.json` (formato em `src/cases-schema.ts`):

1. **Interpretação válida:** a interpretação final passa no `interpretationSchema` (`src/schema.ts`).
2. **Intenção correta:** interpretação válida e `intent` igual ao gabarito.
3. **Tool correta** (inclui "nenhuma" e os argumentos), considerando só as tools de negócio:
   - `expectedTool: "none"`: nenhuma chamada de tool de negócio no turno. **Qualquer** chamada, válida ou recusada, torna o resultado incorreto.
   - Tool específica: há pelo menos uma chamada da tool esperada; toda chamada é da tool esperada ou de `allowedExtraTools` (vazia nos 6 casos); **toda** chamada da tool esperada obedece às regras de `toolArgs.fields` e não contém nenhum nome de `toolArgs.forbidden`. Chamadas recusadas pela validação do Mastra contam. Repetir a mesma chamada válida não reprova, mas entra no consumo.
4. **Entidades e missingFields relevantes:** interpretação válida, todas as regras de `entities` satisfeitas e a regra de `missingFields` satisfeita.

### Regras dos gabaritos

- **Presença:** `required` (existe e obedece à regra), `optional` (pode faltar; se existir, obedece), `absent` (não pode existir).
- **Valores:** `equals` (um dos valores, exatamente), `normalized-contains-any` (texto livre que, normalizado, contém um dos valores) e `any` (qualquer valor aceito pelo schema).
- **missingFields:** `exact` (exatamente a lista, em qualquer ordem, sem repetição) ou `includes` (contém todos os `required` e nenhum dos `forbidden`; os demais são aceitos).
- **Campos de `entities` sem regra** no gabarito são ignorados.

### Representação

- **Campos extras:** os schemas da interpretação e das tools são estritos (o contrato do DM §3.12 é fechado). Campo extra torna a interpretação inválida ou a chamada de tool recusada.
- **Ausente × `null`:** `null` no lugar de um campo ausente é inválido (convenção do DM: opcionais com `?`, nunca `null`).
- **Valores de catálogo** (intent, categoria, tipo, impacto, missingFields): comparação exata, com caixa. "hardware" no lugar de "HARDWARE" é inválido.
- **Texto livre** (`operatingSystem`, `query`, `problem`, `title`, `description`, `reason`): comparação depois da normalização (sem acentos, minúsculas, só letras e algarismos; `normalizeText` em `src/fixtures.ts`). "Windows 10", "windows-10" e "WINDOWS 10" são equivalentes.
- **Ordem:** a ordem de `missingFields` e a ordem das chaves não importam.

## Limites de aprovação

Um candidato é aprovado no spike se atender aos requisitos E1 a E4 **e a todos** os limites:

- interpretação válida pelo Zod: **≥ 17 de 18**;
- intenção correta: **≥ 15 de 18** e maioria correta em **≥ 5 de 6** entradas;
- tool correta (inclui "nenhuma" e os argumentos): **≥ 15 de 18** e maioria correta em **≥ 5 de 6**;
- entidades e missingFields relevantes: **≥ 15 de 18**;
- estabilidade: mesma intenção e tool nas 3 repetições em **≥ 4 de 6** entradas, e **≥ 2** concordantes nas demais;
- "Parou tudo!": **as 3 execuções** com o impacto e a ação esperados;
- vazamento de raciocínio, truncamento de contexto, efeitos externos: **zero**.

Definições:

- **Maioria correta numa entrada:** pelo menos 2 das 3 repetições corretas.
- **Estabilidade:** compara a intenção e o conjunto de tools de negócio chamadas (com "nenhuma" como valor) entre as 3 repetições, certas ou erradas. A intenção de uma interpretação inválida ou de um turno com erro de execução não concorda com nenhuma outra.
- **"Parou tudo!" (C6), impacto e ação esperados:** interpretação válida; `impact.workImpact` = `BLOCKED`; `impact.affectedScope` ausente; nenhuma chamada de tool de negócio; `missingFields` contém `AFFECTED_SCOPE`.

## Critérios classificatórios

Entre os candidatos aprovados, nesta ordem (o primeiro que diferencia decide):

1. **Confiabilidade do contrato:** interpretação válida pelo Zod e tool correta, com os argumentos.
2. **Qualidade da interpretação:** intenção, entidades e missingFields.
3. **Estabilidade entre repetições.**
4. **Latência mediana** por turno.
5. **Recursos:** tokens por turno e memória exigida.

**Desempate:** simplicidade para rodar. Só desempata; não é critério classificatório.

O spike recomenda; a decisão é do ADR-009.

## Aprovações registradas

Decisões do autor sobre esta revisão, em 2026-11-10:

- Códigos de motivo das falhas: `EXEC_*` e `SEM_*` (seção "Erros: semânticos e de execução").
- Erros de execução separados dos semânticos, sem sair do denominador de 18.
- Histórico sintético do C4 (perguntas do assistente redigidas para o spike).
- `HARDWARE` como categoria do C4: [Inferência do spike] aprovada.
- Critério de `title` e `description` do C4: pelo menos um dos termos "segundo monitor", "monitor adicional", "outro monitor", "segunda tela" ou "tela adicional", normalizados.

Decisões do autor em 2026-11-11:

- Critério de `title` e `description` do C4 ampliado com "monitor extra", "monitor secundário" e "mais um monitor", normalizados (`monitorextra`, `monitorsecundario`, `maisummonitor`).
- Limites da cota gratuita do Groq lidos no painel em 2026-11-09 (30 RPM, 1.000 RPD, 8.000 TPM, 200.000 TPD) registrados; o Groq não atende ao E4 e segue só como referência.
- Congelamento da Fase 1.

## Registro de cada execução

Por execução: modelo e digest (Ollama) ou id (Groq); versões dos pacotes; parâmetros efetivos (temperatura, seed, contexto do servidor conferido no `ollama ps`, limites, com N/A onde não suportados); hashes dos arquivos; instante de início e fim; limites de cota lidos (Groq).

Por resultado: caso e repetição; interpretação bruta e resultado da validação Zod; chamadas de tool de negócio (nome, argumentos, recusadas ou executadas), chamadas da tool sintética e o registro das tools falsas; texto final; `finishReason`; tokens e latência do turno e de cada chamada interna; novas tentativas e respostas 429; grupo e motivos de cada falha. Nunca o raciocínio.

## Arquivos

Manifesto SHA-256, **congelado em 2026-11-11** (fins de linha LF, como fixa o `.gitattributes` da raiz). O prompt de sistema (`src/prompt.ts`) faz parte do que é congelado. Este arquivo e o `README.md` não entram no manifesto: o CRITERIA.md não pode conter o próprio hash, e o README só descreve.

| Arquivo | SHA-256 |
| --- | --- |
| `src/prompt.ts` | `2d9054d371d893e2c4deca6b91f82e3a6d7ddc0ecc7a811da8ad382937d84638` |
| `cases.json` | `1be41676436e7ad525daebfe664d8aae3f8f433a18df5b5c79af9146e14db8b1` |
| `src/schema.ts` | `c8e63fb1037a4c5bdb2d0d47a6a82c891110e6ddd5097aa2aefa173876be30ee` |
| `src/models.ts` | `3c6325afd35001c74c9e5cee5de156db6eb0273d817a6afc5defa9a9412fcb13` |
| `src/fixtures.ts` | `86d119a67a973c93b0be7511b9372771b462c156eb54b53d35dff62d530d1a30` |
| `src/tools.ts` | `5e62f88c67469dd950c9fdb3a5abedd43fe657397a35a7b1150753ea67de4b6f` |
| `src/cases-schema.ts` | `00f691ef2a5d7fa5e9e4f37bbc6ebacd13f387dbd3b6fd9a352f3f00821eb651` |
| `src/check-cases.ts` | `51823dc7504ae3eb52da55c8df30c1cd70347405c652264a41dc9caacdd4c504` |
| `package.json` | `bad59360700c962a51defbf1fb16c3a453695958871094e2a5a18e8373d9df3c` |
| `package-lock.json` | `45dbd0a87570ac072dc55f88c7691b342cec044537e1739dc695111a57b96d41` |
| `.npmrc` | `5930232d94754837f39a55b068e2deeefd8f1adea88bd8c55e205f0e832bb32f` |

Conferência, na pasta `spikes/llm-model/`: `sha256sum -c` sobre as linhas `<hash>  <arquivo>` desta tabela.
