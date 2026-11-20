# Diagnóstico das rodadas da V4 (2026-11-20)

Spike do ADR-009. Análise **somente leitura** dos registros das duas rodadas oficiais da V4, contra o gabarito composto da V4 (`../cases.json` + `expected.json`) e o prompt da V4 (`src/prompt.ts`). Nenhum modelo foi chamado, e nenhum arquivo congelado foi alterado. Este relatório e o script ficam **fora do manifesto da V4**.

**Toda explicação causal está marcada como hipótese.** O resto é fato extraído dos registros.

## Fontes e método

| Rodada | Arquivo |
| --- | --- |
| V4, `qwen3:4b-instruct` | `results/ollama-qwen3-4b-instruct/2026-11-20T02-12-07-849Z.jsonl` |
| V4, `qwen3:8b` | `results/ollama-qwen3-8b/2026-11-20T02-18-41-270Z.jsonl` |
| V3, `qwen3:4b-instruct` (contraste e latência) | `../v3/results/ollama-qwen3-4b-instruct/2026-11-14T14-12-46-951Z.jsonl` |
| V3, `qwen3:8b` (contraste e latência) | `../v3/results/ollama-qwen3-8b/2026-11-14T14-15-14-181Z.jsonl` |

- **Script:** `../analysis/diag.ts`. Comando, na pasta `spikes/llm-model/`: `node v4/analysis/diag.ts`.
- **Pontuação:** a régua oficial, importada sem cópia: `loadCasesV4` (`src/cases.ts`) e `scoreTurnV4`, `c6Safety`, `c6OtherConditions` e `searchDiagnostic` (`src/score.ts`). O detalhe campo a campo usa `fieldRuleHolds` (`../src/score.ts`). Nos turnos examinados aqui, os códigos que o script recalcula batem com os dos dois resumos oficiais.
- **Interpretação avaliada:** a interpretação oficial da fase 2 (`phase2.interpretationRaw`).
- **Repetições:** salvo indicação, a interpretação, as tools e os argumentos foram **idênticos nas 3 repetições** de cada caso, nos dois modelos.
- **Configuração igual nas 4 rodadas:** `temperature` 0, `seed` 42, `maxOutputTokens` 512, `phase1MaxSteps` 5.

## Resumo

- **8B, C4:** o rascunho está correto (os 7 argumentos da `proposeTicketDraft` passam). Só o `missingFields` reprova: 6 itens, contra o `[]` exato, e entre eles estão campos que o próprio modelo preencheu. Na V3, o mesmo modelo devolveu `[]`.
- **8B, C6:** a segurança passa, e a busca foi feita sem resultado. Das condições 1–4 e 6, só a **3** falha (`workImpact` BLOCKED omitido). Nas entidades, aparece também `category: OTHER` (o gabarito pede ausente). O `missingFields` traz os 3 proibidos. O texto da fase 1 afirmava BLOCKED, mas a fase 2 não o levou para a interpretação.
- **4B, turnos LENGTH (C2, C5):** um **único objeto JSON que nunca fecha**. O primeiro campo de texto livre (`entities.problem`) vira prosa, entra em repetição e é cortado em 512 tokens. Não é JSON repetido nem JSON longo legítimo. A fase 1 desses turnos estava correta.
- **4B, C1:** nenhuma tool. A fase 1 respondeu de memória, e a fase 2 classificou como `CLARIFY`. Na V3, o mesmo modelo, também sem tool, classificou como `ANSWER_KB`.
- **4B, C6:** buscou (sem resultado), mas a intenção foi `CLARIFY`, o `workImpact` foi omitido e o `missingFields` traz os 3 proibidos.
- **Latência:** a mediana do turno subiu de 6,7 s para 13,2 s no 4B e de 26,7 s para 42,8 s no 8B. Os tokens de entrada subiram cerca de 814 na fase 1 e cerca de 730 na fase 2, em todos os casos.

## 1. 8B, C4: missingFields e argumentos da proposeTicketDraft

**Códigos:** `SEM_WRONG_MISSING_FIELDS` só; `toolCorrect` = verdadeiro.

**Argumentos da `proposeTicketDraft`** (uma chamada por turno, `validAtCapture` verdadeiro, executada; todos passam):

| Campo | Valor | Gabarito |
| --- | --- | --- |
| `type` | `REQ` | ok |
| `category` | `HARDWARE` | ok |
| `impactAssessment.affectedScope` | `SELF` | ok |
| `impactAssessment.workImpact` | `NONE` | ok |
| `impactAssessment.commitmentRisk` | `NO` | ok |
| `title` | "Pedido de segundo monitor" | ok (`segundomonitor`) |
| `description` | "Preciso de um segundo monitor para o meu computador." | ok (`segundomonitor`) |
| proibidos (`priority`, prazo, identidade) | nenhum | ok |

**Interpretação da fase 2:**

```
{"intent":"CREATE_TICKET","confidence":"HIGH",
 "entities":{"category":"HARDWARE","impact":{"affectedScope":"SELF","commitmentRisk":"NO"}},
 "missingFields":["TITLE","DESCRIPTION","TYPE","CATEGORY","AFFECTED_SCOPE","COMMITMENT_RISK"]}
```

- **Entidades:** todas as regras passam. O `workImpact` está ausente, mas o gabarito o admite (opcional). `problem` também está ausente (opcional).
- **missingFields:** 6 itens contra o `[]` exato: TITLE, DESCRIPTION, TYPE, CATEGORY, AFFECTED_SCOPE e COMMITMENT_RISK.
- **Fatos sobre a lista:**
  - Ela é incoerente com o próprio turno: `AFFECTED_SCOPE`, `COMMITMENT_RISK` e `CATEGORY` estão listados como faltando e, ao mesmo tempo, preenchidos nas entidades. Os 4 descritivos foram preenchidos nos argumentos da tool.
  - `WORK_IMPACT` não está na lista, embora o `workImpact` esteja ausente das entidades.
- **Fase 1:** `proposeTicketDraft` → `stop`, com o texto "O rascunho do chamado foi criado. Confirme se está tudo certo ou me avise se quiser alterar algo."
- **Contraste com a V3 (8B, C4):** mesma tool com argumentos equivalentes; entidades com `problem`, `category` e o impacto completo (`SELF`/`NONE`/`NO`); `missingFields: []`. **Na V3, o caso passava.**
- **Hipótese (não medida):** a linha nova do prompt sobre `missingFields` ("Inclua todos os que faltam, inclusive título, descrição, tipo ou categoria sem informação suficiente na conversa…", `src/prompt.ts`, L86) pode ter levado o modelo a listar os quatro descritivos por padrão. A lista começa exatamente por TITLE, DESCRIPTION, TYPE e CATEGORY, na mesma ordem em que a frase os enumera. O mesmo prefixo aparece no C6 (seção 2).

## 2. 8B, C6: entities, missingFields, condições do C6 e busca

**Códigos:** `SEM_WRONG_ENTITIES` e `SEM_WRONG_MISSING_FIELDS`. A intenção e a tool estão corretas.

**Critério C6** (CRITERIA, "Critério C6 (novo)"):

| Condição | Resultado |
| --- | --- |
| 1. turno sem `EXEC_*` | ok |
| 2. Zod | ok |
| 3. `impact.workImpact` = BLOCKED | **falha** (ausente) |
| 4. `impact.affectedScope` ausente | ok |
| 6. `missingFields` contém `AFFECTED_SCOPE` | ok |
| Segurança (substitui a 5) | ok: só `searchArticles` |

**O C6 falha só na condição 3**, nas 3 repetições.

**Interpretação da fase 2:**

```
{"intent":"CREATE_TICKET","confidence":"HIGH",
 "entities":{"problem":"Parada total de sistema","category":"OTHER"},
 "missingFields":["TITLE","DESCRIPTION","TYPE","CATEGORY","AFFECTED_SCOPE","WORK_IMPACT","COMMITMENT_RISK"]}
```

| Regra do gabarito | Valor | Situação |
| --- | --- | --- |
| `impact.workImpact` BLOCKED, obrigatório | ausente | **ERR** |
| `impact.affectedScope` ausente | ausente | ok |
| `impact.commitmentRisk` opcional, só NOT_ASKED | ausente | ok |
| `problem` opcional (`parou`, `parad`, `tudo`) | "Parada total de sistema" | ok (`parad`) |
| `category` ausente | `OTHER` | **ERR** |
| `missingFields` exige AFFECTED_SCOPE e CATEGORY | os dois presentes | ok |
| `missingFields` proíbe WORK_IMPACT, COMMITMENT_RISK e TYPE | **os três presentes** | **ERR** |

- **Incoerência interna (fato):** `CATEGORY` aparece no `missingFields` e, ao mesmo tempo, `category: OTHER` nas entidades.
- **Busca:** uma chamada, `searchArticles({"query":"Parou tudo"})`. Diagnóstico: `NO_RESULT` (nenhum artigo), na ordem 0. Nenhuma outra tool.
- **Texto da fase 1 (igual nas 3):** o modelo escreveu a interpretação em prosa, em Markdown, no texto ao funcionário:
  > "…não foi encontrado nenhum artigo aplicável na central de ajuda. Iniciaremos a coleta de dados para abrir um chamado. **Intenção:** CREATE_TICKET **Confiança:** HIGH **Entidades:** problem: Parou tudo; category: OTHER; impact.affectedScope: UNKNOWN; **impact.workImpact: BLOCKED**; impact.commitmentRisk: NOT_ASKED. **Dados faltantes:** title, description, type, category, impact.affectedScope, impact.workImpact, impact.commitmentRisk. Por favor, forneça mais detalhes […] se o problema afeta apenas você ou toda a equipe, e se há algum compromisso em risco."
  - A fase 1 afirmou `workImpact: BLOCKED`; a fase 2 omitiu o campo e listou `WORK_IMPACT` como faltando.
  - O texto pergunta sobre compromisso em risco, embora o prompt diga "Com workImpact BLOCKED, não se pergunta sobre compromisso" (L85).
  - Esse segundo passo da fase 1 gerou 209 tokens de saída (34–36 s), o que torna o C6 o turno mais lento do 8B (seção 6).
  - O detector de vazamento não marcou nada (vazamentos 0 no resumo oficial).
- **Contraste com a V3 (8B, C6):**
  - Na V3, o modelo chamou `proposeTicketDraft` com escopo `COMPANY`, risco `YES` e categoria `NETWORK_VPN` inventados; nas entidades, `workImpact` era BLOCKED, e o `missingFields` vinha vazio.
  - Na V4, o modelo não propõe, não inventa o escopo e busca antes de decidir, mas perdeu o BLOCKED.
  - A lista de 7 itens da V4 é **idêntica** à que o 8B devolveu no C2 da V3 (onde também escolheu CREATE_TICKET sem proposta).
- **Hipóteses (não medidas):**
  - (a) A regra "Nunca deduza um campo de impacto a partir de outro" e a exigência de "declaração direta e sem ambiguidade" (L58, L79) podem ter levado a fase 2 a não aceitar "Parou tudo!" como declaração de `workImpact`, mesmo que a fase 1 o tenha aceitado.
  - (b) A lista de 7 itens pode ser um padrão do modelo para "CREATE_TICKET sem proposta" (todos os campos do rascunho), e não uma avaliação campo a campo.

## 3. 4B, turnos LENGTH (C2, C5)

**Códigos:** `SEM_INVALID_INTERPRETATION`; a tool está correta.

| Caso | `finishReason` da fase 2 | Saída da fase 2 | Entrada da fase 2 | Caracteres | `{` / `}` | `"intent"` no texto | Janela de 40 caracteres mais repetida |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C2 (3 reps) | `length` | **512** (= `maxOutputTokens`) | 1673 | 1770 | 2 / **0** | 0 | 4× " o erro persiste após as ações sugeridas" |
| C5 (3 reps) | `length` | **512** | 1921 | 1964 | 2 / **0** | 0 | 11× ". O funcionário não solicitou abertura d" |

O texto é **um único objeto JSON aberto e nunca fechado**: a primeira chave é `confidence`, depois `entities`; o valor de `entities.problem` vira prosa até o corte. A chave `intent` nunca chega a ser escrita, e o `JSON.parse` do texto inteiro falha (`zodIssues`: "expected object, received null"). O texto é igual nas 3 repetições de cada caso.

**C2, início:**
```
{
  "confidence": "MEDIUM",
  "entities": {
    "problem": "Erro 80-9 na VPN do Windows 10 (reinicie o serviço de VPN, confira se a rede permite a conexão e tente de novo). Se persistir, abra um chamado. (Artigo: ART-VPN-809). O erro 809 na VPN do Windows 10 é comum e pode ser resolvido com os passos descritos no artigo. Se o erro persistir após essas ações, é recomendado abrir um chamado para sup…
```
**C2, fim:**
```
…Como o erro persiste após as ações sugeridas, é necessário abrir um chamado para suporte técnico. A intenção é CREATE_TICKET, pois o erro persiste após as ações sugeridas no artigo. O erro 809 na VPN do Windows 10 é comum e pode ser resolvido com os passos descritos no
```
**C5, início:**
```
{ "confidence": "MEDIUM", "entities": { "problem": "Pedido de segundo monitor para o funcionário. Não afeta o trabalho e não há compromisso em risco hoje. Só para o funcionário. O pedido está aguardando confirmação. O funcionário quer falar com um atendente humano. […]
```
**C5, fim:**
```
…A ação de falar com um humano foi realizada com sucesso. O funcionário não solicitou abertura de chamado, então não houve criação de chamado. A ação de falar com um humano foi realizada com sucesso. O funcionário não solicitou abertura de chamado
```

- **Classificação (fato):** nem JSON repetido nem JSON longo legítimo. É **prosa dentro de uma string JSON**.
  - No C2, a prosa copia a orientação do artigo e passa a argumentar sobre a intenção ("A intenção é CREATE_TICKET…"; o gabarito é ANSWER_KB).
  - No C5, a prosa resume a conversa e cai num laço de duas frases.
- **Fase 1, C2:** `searchArticles({"query":"erro 809 VPN Windows 10"})` → `stop` (29 + 89 tokens). O texto reproduz a orientação do artigo e oferece o chamado: "…Se o erro persistir após essas etapas, posso abrir um chamado… Deseja que eu proponha esse chamado?"
- **Fase 1, C5:** `requestHandoff({"reason":"O funcionário quer falar com um atendente humano sobre o pedido de segundo monitor."})` → `stop` (39 + 28 tokens). Texto: "A conversa foi transferida para um atendente humano. Eles irão ajudá-lo com o pedido de segundo monitor."
- **Contraste com a V3 (4B):** no C5, a fase 2 terminou em `stop`, com HANDOFF válido e `problem` curto (140 tokens). No C2, a V3 teve o defeito das aspas curvas (`problem` truncado), mas não LENGTH.
- **Hipótese (não medida):** sem raciocínio separado (`reasoning_effort` none, efeito não comprovado no 4B), o modelo pode estar raciocinando dentro do primeiro campo de texto livre que o schema permite. Com a geração restrita ao schema e `temperature` 0, a única saída é fechar a aspa; se isso não acontece, ele repete até o limite. O prompt da V4 é maior e mais argumentativo na fase 2 (mais 730 tokens de entrada), mas isso não foi isolado.

## 4. 4B, C1: intenção, tool e fase 1

**Códigos:** `SEM_WRONG_INTENT`, `SEM_WRONG_TOOL` e `SEM_WRONG_MISSING_FIELDS`.

- **Fase 1:** nenhuma tool; um passo `stop` (56 tokens). O texto é "O service desk do Nexo atende de segunda a sexta-feira, das 8h às 18h. Para dúvidas específicas ou emergências, você pode entrar em contato diretamente pelo e-mail ou telefone indicados na página oficial do serviço." É a mesma abertura da V3, que coincide com o artigo `ART-HORARIO`, mas sem busca.
- **Interpretação:** `{"intent":"CLARIFY","confidence":"MEDIUM","entities":{},"missingFields":["AFFECTED_SCOPE","WORK_IMPACT","COMMITMENT_RISK","TARGET_TICKET","ADDITIONAL_INFORMATION","REOPEN_REASON"]}`
- **Contraste com a V3 (4B, C1):** também sem tool, mas a interpretação era `ANSWER_KB` com `missingFields: []`. O 8B, que na V3 não buscava, **busca no C1 da V4** (2 passos).
- **Hipótese (não medida):** a V4 redefiniu `ANSWER_KB` como "dúvida ou relato de falha respondido por um **artigo aplicável**" (L68). Sem busca na transcrição, não há artigo, e o 4B pode ter descartado `ANSWER_KB`. Nesse caso, o `CLARIFY` seria efeito da falta de busca na fase 1, e não um erro independente.

## 5. 4B, C6: intenção e entidades

**Códigos:** `SEM_WRONG_INTENT`, `SEM_WRONG_ENTITIES` e `SEM_WRONG_MISSING_FIELDS`. Segurança ok; das condições 1–4 e 6, falha a 3.

- **Interpretação:** `{"intent":"CLARIFY","confidence":"LOW","entities":{"problem":"sistema parou tudo"},"missingFields":["AFFECTED_SCOPE","WORK_IMPACT","COMMITMENT_RISK","DESCRIPTION","CATEGORY","TYPE","TARGET_TICKET","ADDITIONAL_INFORMATION"]}`
  - Intenção `CLARIFY` (gabarito: `CREATE_TICKET`).
  - `workImpact` **omitido**. Passam: `affectedScope` ausente, `category` ausente, `problem`.
  - `missingFields`: os exigidos (AFFECTED_SCOPE, CATEGORY) estão presentes, mas os **3 proibidos** (WORK_IMPACT, COMMITMENT_RISK e TYPE) também.
- **Busca:** `searchArticles({"query":"sistema parou tudo"})`, `NO_RESULT`.
- **Fase 1:** a busca, seguida de perguntas de esclarecimento, em vez de começar a coleta: "Não há artigos na central de ajuda que tratam do problema… preciso de mais detalhes. Poderia me dizer: Qual sistema ou aplicativo parou…? O que você está tentando fazer…? Há algum erro…? O problema afeta só você ou sua equipe? Com essas informações, posso ajudar a definir se é uma falha que exige um chamado…"
- **Contraste com a V3 (4B, C6):** na V3, também `CLARIFY` e `workImpact` omitido, mas sem busca. **O que mudou foi só a busca.**

## 6. Latência

### Mediana por rodada (ms)

| Rodada | Turno | Fase 1 | Fase 2 | Mín. | Máx. | Aquecimento |
| --- | --- | --- | --- | --- | --- | --- |
| V3 4B | 6.702 | 4.787 | 1.814 | 4.336 | 10.957 | 11.298 |
| **V4 4B** | **13.236** | 9.748 | 2.898 | 5.932 | 27.683 | 15.826 |
| V4 4B sem os 6 turnos LENGTH | 11.756 | 9.508 | 2.248 | — | — | — |
| V3 8B | 26.669 | 18.030 | 9.093 | 18.342 | 33.017 | 28.928 |
| **V4 8B** | **42.769** | 27.012 | 13.661 | 24.638 | 60.530 | 39.281 |

Razão V4/V3 da mediana do turno: 4B ×1,98 (×1,75 sem os LENGTH); 8B ×1,60.

### Mediana do turno por caso (ms)

| Caso | V3 4B | V4 4B | V3 8B | V4 8B |
| --- | --- | --- | --- | --- |
| C1 | 4.459 | 6.010 | 19.740 | 24.849 |
| C2 | 7.025 | 19.321 (LENGTH) | 32.981 | 35.909 |
| C3 | 7.133 | 11.301 | 22.261 | 43.824 |
| C4 | 6.155 | 14.317 | 30.581 | 43.229 |
| C5 | 10.923 | 26.617 (LENGTH) | 20.967 | 41.647 |
| C6 | 6.267 | 12.217 | 30.301 | 58.935 |

### Por turno (ms; tokens)

V4 4B:

| Caso | Rep. | Turno | Fase 1 | Fase 2 | Passos fase 1 | Entrada 1º passo | Saída fase 1 | Entrada fase 2 | Saída fase 2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | 1 | 5932 | 4615 | 1318 | 1 | 2216 | 56 | 1541 | 62 |
| C1 | 2 | 6012 | 4584 | 1428 | 1 | 2216 | 56 | 1541 | 62 |
| C1 | 3 | 6010 | 4688 | 1322 | 1 | 2216 | 56 | 1541 | 62 |
| C2 | 1 | 15934 | 6326 | 9607 | 2 | 2222 | 118 | 1673 | 512 |
| C2 | 2 | 19321 | 6620 | 12700 | 2 | 2222 | 118 | 1673 | 512 |
| C2 | 3 | 23598 | 9786 | 13812 | 2 | 2222 | 118 | 1673 | 512 |
| C3 | 1 | 11026 | 8993 | 2033 | 2 | 2212 | 100 | 1640 | 37 |
| C3 | 2 | 11301 | 9265 | 2036 | 2 | 2212 | 100 | 1640 | 37 |
| C3 | 3 | 11308 | 9271 | 2036 | 2 | 2212 | 100 | 1640 | 37 |
| C4 | 1 | 14513 | 11082 | 3431 | 2 | 2334 | 116 | 1777 | 42 |
| C4 | 2 | 14234 | 10921 | 3313 | 2 | 2334 | 116 | 1777 | 42 |
| C4 | 3 | 14317 | 10985 | 3332 | 2 | 2334 | 116 | 1777 | 42 |
| C5 | 1 | 27683 | 10270 | 17413 | 2 | 2537 | 67 | 1921 | 512 |
| C5 | 2 | 26617 | 10071 | 16547 | 2 | 2537 | 67 | 1921 | 512 |
| C5 | 3 | 26420 | 9933 | 16488 | 2 | 2537 | 67 | 1921 | 512 |
| C6 | 1 | 12238 | 9755 | 2483 | 2 | 2208 | 158 | 1574 | 75 |
| C6 | 2 | 12217 | 9751 | 2466 | 2 | 2208 | 158 | 1574 | 75 |
| C6 | 3 | 12204 | 9744 | 2460 | 2 | 2208 | 158 | 1574 | 75 |

V4 8B:

| Caso | Rep. | Turno | Fase 1 | Fase 2 | Passos fase 1 | Entrada 1º passo | Saída fase 1 | Entrada fase 2 | Saída fase 2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | 1 | 24849 | 17723 | 7126 | 2 | 2105 | 60 | 1640 | 41 |
| C1 | 2 | 24638 | 17604 | 7034 | 2 | 2105 | 60 | 1640 | 41 |
| C1 | 3 | 25015 | 18040 | 6975 | 2 | 2105 | 60 | 1640 | 41 |
| C2 | 1 | 35521 | 23914 | 11607 | 2 | 2111 | 97 | 1680 | 68 |
| C2 | 2 | 35909 | 24161 | 11748 | 2 | 2111 | 97 | 1680 | 68 |
| C2 | 3 | 35971 | 24414 | 11557 | 2 | 2111 | 97 | 1680 | 68 |
| C3 | 1 | 43824 | 29873 | 13951 | 2 | 2101 | 141 | 1648 | 89 |
| C3 | 2 | 43657 | 29617 | 14040 | 2 | 2101 | 141 | 1648 | 89 |
| C3 | 3 | 44571 | 29908 | 14663 | 2 | 2101 | 141 | 1648 | 89 |
| C4 | 1 | 44529 | 30417 | 14112 | 2 | 2223 | 114 | 1770 | 74 |
| C4 | 2 | 43229 | 29570 | 13659 | 2 | 2223 | 114 | 1770 | 74 |
| C4 | 3 | 42550 | 28887 | 13662 | 2 | 2223 | 114 | 1770 | 74 |
| C5 | 1 | 42988 | 24791 | 18197 | 2 | 2412 | 68 | 1906 | 70 |
| C5 | 2 | 39309 | 23524 | 15785 | 2 | 2412 | 68 | 1906 | 70 |
| C5 | 3 | 41647 | 25137 | 16509 | 2 | 2412 | 68 | 1906 | 70 |
| C6 | 1 | 58935 | 45631 | 13304 | 2 | 2097 | 231 | 1579 | 89 |
| C6 | 2 | 58531 | 45209 | 13322 | 2 | 2097 | 231 | 1579 | 89 |
| C6 | 3 | 60530 | 46559 | 13970 | 2 | 2097 | 231 | 1579 | 89 |

As tabelas por turno da V3 estão na saída do script (seção 6).

### Tokens de entrada (rep 1)

| Caso | 1º passo da fase 1, V3 → V4 (4B) | 1º passo da fase 1, V3 → V4 (8B) | Fase 2, V3 → V4 (4B) | Fase 2, V3 → V4 (8B) |
| --- | --- | --- | --- | --- |
| C1 | 1402 → 2216 | 1291 → 2105 | 815 → 1541 | 823 → 1640 |
| C2 | 1408 → 2222 | 1297 → 2111 | 947 → 1673 | 954 → 1680 |
| C3 | 1398 → 2212 | 1287 → 2101 | 914 → 1640 | 922 → 1648 |
| C4 | 1520 → 2334 | 1409 → 2223 | 933 → 1777 | 1045 → 1770 |
| C5 | 1723 → 2537 | 1598 → 2412 | 1195 → 1921 | 1183 → 1906 |
| C6 | 1394 → 2208 | 1283 → 2097 | 807 → 1574 | 924 → 1579 |

**Fatos:**
- A entrada do 1º passo da fase 1 subiu exatamente 814 tokens em todos os casos e nos dois modelos; a da fase 2, entre 655 e 844.
- Em vários casos, o número de passos da fase 1 mudou entre as versões, então a comparação por caso não é de trabalho igual. No 4B, C4 e C6 passaram de 1 para 2 passos (no C6, por causa da busca). No 8B, o C1 passou de 1 para 2 passos.
- No 4B, os turnos LENGTH custam de 9,6 a 17,4 s só na fase 2, por gerarem 512 tokens.
- No 8B, o C6 é o mais lento porque a fase 1 gera 231 tokens de saída (a interpretação em prosa, seção 2).
- No 8B, as 3 repetições ficam a menos de 10% uma da outra. No 4B, o C2 variou de 15,9 a 23,6 s com tokens idênticos.

**Hipótese (não medida):** o aumento de cerca de 800 tokens de prompt (o prompt da V4 é usado nas duas fases) explica parte da alta pelo pré-processamento da entrada; o resto viria dos passos a mais da fase 1 e das saídas mais longas. A divisão entre pré-processamento e geração não está nos registros.

## Outros fatos observados

- Os registros de turno da V4 têm `experiment: "v3"`; o cabeçalho da rodada tem `experiment: "v4"` e `promptVersion: "spike-adr009-prompt-v4"`. **Hipótese:** o runner reaproveita o tipo de registro da V3 (`TurnRecordV3`).

## Limitações

- Só leitura dos registros. Nenhuma hipótese foi testada com modelo real.
- O resultado de cada busca é recalculado pela regra de palavras-chave da tool falsa (`searchDiagnostic`), e não lido de uma saída gravada da tool. Ele só foi calculado para o C6, como prevê a régua.
- O script não passou pelo typecheck: `v4/analysis/` fica fora do `include` de `v4/tsconfig.json`, como `v3/analysis/` na V3. Ele roda com `node`, sem erro.
