# Diagnóstico das rodadas da V3 (2026-11-14)

Spike do ADR-009. Análise **somente leitura** dos registros das rodadas oficiais da V3 e das rodadas da V2.1, contra o gabarito (`cases.json`) e o prompt da V1 (`src/prompt.ts`). Nenhum modelo foi chamado, e nenhum arquivo congelado foi alterado. Este relatório e o script ficam **fora do manifesto da V3**.

**Toda explicação causal está marcada como hipótese.** O resto é fato extraído dos registros.

## Fontes e método

| Rodada | Arquivo |
| --- | --- |
| V3, `qwen3:4b-instruct` | `v3/results/ollama-qwen3-4b-instruct/2026-11-14T14-12-46-951Z.jsonl` |
| V3, `qwen3:8b` | `v3/results/ollama-qwen3-8b/2026-11-14T14-15-14-181Z.jsonl` |
| V2.1, `qwen3:4b-instruct` | `v2/results/ollama-qwen3-4b-instruct/2026-11-13T11-37-58-782Z.jsonl` |
| V2.1, `qwen3:8b` | `v2/results/ollama-qwen3-8b/2026-11-13T11-39-04-631Z.jsonl` |

- **Script:** `v3/analysis/diag.ts`. Comando, na pasta `spikes/llm-model/`: `node v3/analysis/diag.ts`.
- **Interpretação avaliada:** na V3, a interpretação oficial da fase 2 (`phase2.interpretationRaw`); na V2.1, os argumentos da primeira `submitInterpretation` emitida.
- **Regras:** o detalhe campo a campo usa as regras do gabarito da V1 (`fieldRuleHolds`, de `src/score.ts`).

## Resumo

- **C1:** na V3, nenhum dos dois modelos chamou `searchArticles`; os dois responderam em texto na fase 1.
- **C4, 4B:** na V3, o modelo não chamou `proposeTicketDraft` e perguntou o "tipo" usando valores de categoria.
- **C6, 8B:** na V3, o modelo chamou `proposeTicketDraft` com escopo, risco e categoria inventados.
- **Entidades do 4B na V3 (C2 e C4):** a falha vem de um **defeito de formatação** no texto da fase 2: o valor de `problem` termina em aspas curvas, e os campos seguintes somem.
- **Gabarito:** C2, C4 e C6 têm pontos em que o prompt da V1 admite mais de uma leitura (seção 5).

## 1. Tools emitidas: fase 1 da V3 × V2.1 × gabarito

Cada célula vale para as 3 repetições, salvo indicação.

| Caso | Gabarito | V3 4B | V2.1 4B | V3 8B | V2.1 8B |
| --- | --- | --- | --- | --- | --- |
| C1 | `searchArticles` | **nenhuma** | `searchArticles` ✓ | **nenhuma** | `searchArticles` ✓ |
| C2 | `searchArticles` | `searchArticles` ✓ | `searchArticles` ✓ | `searchArticles` ✓ | **nenhuma** |
| C3 | `listMyTickets` | ✓ | ✓ | ✓ | ✓ |
| C4 | `proposeTicketDraft` | **nenhuma** | `proposeTicketDraft` ✓ | `proposeTicketDraft` ✓ | **nenhuma** |
| C5 | `requestHandoff` | ✓ | ✓ | ✓ | ✓ |
| C6 | nenhuma | nenhuma ✓ | nenhuma ✓ | **`proposeTicketDraft`** | nenhuma ✓ |

**O que o modelo fez em vez da tool**, nos `SEM_WRONG_TOOL` da V3 (texto final da fase 1, que não é avaliado; igual nas 3 repetições):

| Rodada | Fase 1 | Texto |
| --- | --- | --- |
| C1, V3 4B | um passo `stop`, nenhuma tool | "O service desk do Nexo atende de segunda a sexta-feira, das 8h às 18h. Para dúvidas específicas, você pode também consultar a central de ajuda…" O texto coincide com o artigo `ART-HORARIO` das fixtures, mas nenhuma tool foi chamada, então ele não veio da busca |
| C1, V3 8B | um passo `stop`, nenhuma tool | "A central de ajuda da Nexo está disponível 24 horas por dia, 7 dias por semana…" Não coincide com o artigo |
| C4, V3 4B | um passo `stop`, nenhuma tool | "Falta apenas o tipo de chamado. Como você quer que esse pedido seja registrado: como um pedido de acesso (ACCESS) ou como um pedido de equipamento (HARDWARE)?" Pergunta pelo tipo usando valores de **categoria** |
| C6, V3 8B | `proposeTicketDraft` → `stop` | "Confirme se o título, a descrição, a categoria, o tipo e a avaliação de impacto estão corretos. Se sim, o chamado será criado." |

## 2. Entidades e missingFields, campo a campo

Só aparecem as divergências; a interpretação foi igual nas 3 repetições de cada linha.

| Rodada | Caso | Interpretação | Divergência do gabarito |
| --- | --- | --- | --- |
| V3 4B | C2 | `ANSWER_KB`; `problem: "erro 809 na VPN no Windows 10”, "`; missing `[]` | `operatingSystem` **omitido** (obrigatório) |
| V3 4B | C4 | `CREATE_TICKET`; `problem: "Preciso de um segundo monitor”, "`; missing `[CATEGORY, TYPE, DESCRIPTION, TARGET_TICKET]` | `impact.affectedScope` **omitido** (obrigatório); missing com 4 itens **sem estar faltando** (o gabarito é exato: `[]`) |
| V3 4B | C6 | `CLARIFY`; `problem` ok; missing `[CATEGORY, WORK_IMPACT, COMMITMENT_RISK, DESCRIPTION]` | `impact.workImpact` **omitido**; missing **sem** `AFFECTED_SCOPE` e **com** `WORK_IMPACT` e `COMMITMENT_RISK` (proibidos) |
| V3 8B | C2 | `CREATE_TICKET`; `operatingSystem: "Windows 10"` ✓; `impact` SELF/BLOCKED/NOT_ASKED; missing com os 7 campos do pedido de chamado | intenção errada; missing com 7 itens **sem estar faltando**. O `impact` está fora das regras do gabarito e não pesa |
| V3 8B | C6 | `CREATE_TICKET` ✓; `workImpact: BLOCKED` ✓; `affectedScope: COMPANY`; `commitmentRisk: YES`; `category: NETWORK_VPN`; missing `[]` | `affectedScope` **presente** (devia estar ausente); `commitmentRisk` YES (o gabarito admite só NOT_ASKED, opcional); missing **sem** `AFFECTED_SCOPE` |
| V2.1 8B | C2 | igual ao V3 8B | igual ao V3 8B |
| V2.1 8B | C4 | entidades ✓ (SELF/NONE/NO, HARDWARE); missing com os 7 | só o missing: 7 itens **sem estar faltando** |
| V2.1 4B e 8B | C6 | ver a seção 3 | — |
| V2.1 (vários) | C1, C3, C4, C5 | sem interpretação (sem submissão) | — |

**Defeito de formatação no 4B da V3** (fato):
- Ocorre em 6 de 18 turnos (C2 e C4, as 3 repetições de cada); no 8B, em 0 de 18.
- O texto da fase 2 é, por exemplo:
  ```
  {"confidence": "MEDIUM", "entities": {"problem": "erro 809 na VPN no Windows 10”, "\n  },"intent": "ANSWER_KB", "missingFields": []}
  ```
- O valor de `problem` termina com aspas curvas (`”`), vírgula e espaço, e logo depois uma aspa reta fecha a string e o objeto `entities`.
- O JSON é válido (passa no Zod), mas os campos seguintes não existem: o `operatingSystem` sumiu no C2 e o `impact` no C4.
- O `object` do Mastra traz o mesmo conteúdo.
- **Hipótese:** o modelo tentou fechar a string com aspas curvas e seguir para a próxima chave, e a geração restrita ao schema (`response_format`) tratou o `”` como conteúdo da string. **Não foi medido.**

## 3. C6: intenção, impacto e tool

| Rodada | intent (esp. `CREATE_TICKET`) | `workImpact` (esp. `BLOCKED`) | `affectedScope` (esp. ausente) | missingFields (exige `AFFECTED_SCOPE`; proíbe `WORK_IMPACT`, `COMMITMENT_RISK`) | Tools (esp. nenhuma) |
| --- | --- | --- | --- | --- | --- |
| V3 4B | **CLARIFY** | **omitido** | ausente ✓ | **sem** `AFFECTED_SCOPE`; **com** os 2 proibidos | nenhuma ✓ |
| V3 8B | CREATE_TICKET ✓ | BLOCKED ✓ | **COMPANY** | **vazio** | **`proposeTicketDraft`** (`affectedScope` COMPANY, `commitmentRisk` YES, `category` NETWORK_VPN) |
| V2.1 4B | **CLARIFY** | **NONE** | **UNKNOWN** | com os 2 proibidos | nenhuma ✓ |
| V2.1 8B | **CLARIFY** | **omitido** | ausente ✓ | com os 2 proibidos | nenhuma ✓ |

Separando os erros:
- **Intenção:** CLARIFY em 3 das 4 rodadas.
- **Impacto:** só o 8B da V3 acertou o BLOCKED, mas inventou o escopo e o risco de compromisso.
- **Tool indevida:** só no 8B da V3.

## 4. Fase de tools da V2.1 × fase 1 da V3 (só fatos, sem atribuir causa)

| Aspecto | V2.1 | V3, fase 1 |
| --- | --- | --- |
| Prompt | V1 com a L30 trocada (instrução de chamar `submitInterpretation` por último) | V1 sem mudança |
| Tools na requisição | 4 de negócio + `submitInterpretation` (5) | 4 de negócio |
| Término | `stopWhen` na submissão aceita ou no passo violado, ou `maxSteps` 5 | resposta sem tool ou `maxSteps` 5 |
| Guarda de passo | sim (recusa composição inválida) | não (o `TurnProtocol` só registra) |
| Igual nas duas | `toolChoice: "auto"`, `MODEL_SETTINGS`, `REASONING_CONTROL`, sem `structuredOutput`, `maxSteps` 5, casos e fixtures | — |

## 5. Onde a régua admite mais de uma leitura

Sem propor mudança no gabarito; só os trechos onde a leitura pode variar.

### C1: tool

- **Gabarito:** `"expectedTool":"searchArticles"`.
- **Prompt:** "Para dúvidas, busque na central de ajuda e responda só com o que os artigos encontrados dizem. Se nenhum artigo se aplica, diga isso, sem inventar." (L22) e "ANSWER_KB: dúvida que a central de ajuda responde."
- **Leitura:** pouca ambiguidade, porque a regra manda buscar. A única brecha é "Use apenas as ferramentas disponíveis" (L19), que não obriga a usar uma tool.

### C2: intenção (8B, nas duas versões)

- **Gabarito:** `"intent":"ANSWER_KB"`, `missingFields` exato `[]`.
- **Prompt:** "ANSWER_KB: dúvida que a central de ajuda responde", "CREATE_TICKET: abrir um chamado novo" e "Tipos de chamado: INC (algo parou ou não funciona)" (L27).
- **Leitura:** "Minha VPN está dando erro 809. Uso Windows 10." é um relato de falha sem pedido explícito. Pode ser lido como dúvida (KB) ou como INC (chamado). Escolhida a intenção do 8B (CREATE_TICKET), listar os 7 campos é coerente com ela.
- **Brecha extra:** o `impact` que o 8B preencheu contraria "entities: preencha só o que o funcionário disse; nunca presuma um valor" (L43), mas está fora das regras do gabarito.

### C4: tool e missingFields

- **Gabarito:** `toolArgs` exige `type: REQ`, `category: HARDWARE`, `title` e `description` (com termos como "segundomonitor"), mais os três campos de impacto; `missingFields` exato `[]`.
- **Prompt:** "Só chame proposeTicketDraft quando título, descrição, tipo, categoria e a avaliação de impacto estiverem completos." (L23), contra "nunca presuma um valor" (L43).
- **Leitura:** o funcionário não disse título, descrição, tipo nem categoria.
  - O tipo dá para deduzir de "REQ (pedido de acesso, equipamento ou software)" (L27).
  - Título e descrição precisam ser redigidos.
  - O "nunca presuma" pode ser lido como valendo também para os argumentos da tool e para o `missingFields`. Esse é o que o 4B da V3 (que perguntou o tipo) e o 8B da V2.1 (que listou os 7 campos) fizeram.
  - O gabarito escolhe a leitura de que tudo pode ser inferido.

### C6: intenção e impacto

- **Gabarito:** `CREATE_TICKET`; `impact.workImpact` BLOCKED obrigatório; `impact.affectedScope` ausente; `missingFields` inclui `AFFECTED_SCOPE` e proíbe `WORK_IMPACT` e `COMMITMENT_RISK`. A V1 justifica em `CRITERIA.md`, "Parou tudo!".
- **Prompt:** "CLARIFY: não é possível saber o que o funcionário quer", "impact.workImpact: BLOCKED (parado, não consegue trabalhar)" e "nunca presuma um valor".
- **Leitura:** "Parou tudo!", sem contexto, admite CLARIFY (o que parou?), como escolheram 3 das 4 rodadas. Ler BLOCKED exige inferir que "parou tudo" quer dizer "não consigo trabalhar", o que fica em tensão com o "nunca presuma".
- **Brecha extra:** o 8B da V3 seguiu a leitura do gabarito na intenção e no impacto. Mas a tool e os valores inventados ferem a L23 ("colete primeiro o que falta") e a L43, sem ambiguidade nesse ponto.

### C2 e C4 no 4B: entidades

Não é ambiguidade da régua; é o defeito de formatação da seção 2. O 4B ia preencher `problem` com o sistema operacional (C2) ou o pedido (C4) embutido no texto.

## Limitações

- Só leitura dos registros. Nenhuma hipótese foi testada com modelo real.
- Os textos citados são os que estão nos registros, já com a remoção de raciocínio da V1 (nenhum marcador foi encontrado nessas rodadas).
- A V2.1 não tem interpretação nos turnos sem submissão (4B: C1, C3, C4 e C5; 8B: C1, C3 e C5); a comparação de entidades com a V3 só vale onde as duas têm interpretação.
