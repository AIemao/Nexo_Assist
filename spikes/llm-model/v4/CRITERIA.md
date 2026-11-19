# Spike do ADR-009, V4: instruções conforme as decisões D25–D27

**Estado: APROVADO em 2026-11-16. Gabarito, régua e instruções ainda não congelados (ver "Ordem de trabalho").**

Rótulos das fontes: **[AF]** `docs/architecture/03-agent-flow.md` v1.6 (com o esclarecimento da D25 de 2026-11-16); **[Cenário]** `docs/evaluation/01-evaluation-scenarios.md` v1.7; **[DM]** `docs/architecture/01-domain-model.md` v2.13; **[PRD]** README (anexos); **[Premissa do spike]** escolha do spike, sem fonte na especificação (as decisões do autor de 2026-11-16 têm esse rótulo); **PENDENTE** ausente da especificação.

## Pergunta da V4

Com o desenho da V3 (D1: interpretação numa chamada separada) e uma única variável alterada, **o texto descritivo que o modelo lê**, os candidatos atendem ao comportamento esperado depois das decisões D25–D27?

## Relação com a V3

- **A V3 continua congelada e é o resultado oficial dela.** Nenhum arquivo da V1, da V2.1 ou da V3 é alterado.
- **Linha de base:** os registros oficiais da V3, **repontuados** com o gabarito e a régua da V4. A repontuação **não é oficial** e não substitui o resultado da V3.
- **Mesma régua para os dois:** a linha de base e a V4 são pontuadas pelo mesmo gabarito e pelas mesmas funções.
- **As respostas dos modelos nunca são fonte do comportamento esperado.** O gabarito vem só da especificação.

## Não é baseline

Como nas versões anteriores, o spike recomenda; a decisão é do ADR-009. Nenhum resultado da V4 constitui baseline do projeto.

## Variável

**A variável da V4 é todo texto descritivo que o modelo lê** [Premissa do spike]:

- **o prompt de sistema**, nas duas fases, como na V3 (a V3 usa o mesmo `SYSTEM_PROMPT` na fase 1 e na fase 2). O texto distingue as responsabilidades:
  - **fase 1:** conduz o turno e executa as tools, inclusive a busca conforme a D25;
  - **fase 2:** interpreta a transcrição e produz a saída estruturada, sem tools;
- **as descrições das tools** (`description` de cada `createTool`), que só existem na fase 1;
- **os textos `.describe` dos schemas**: os dos argumentos das tools (fase 1) e os do `interpretationSchema` (fase 2, na saída estruturada).

**A estrutura dos schemas fica fixa:** nomes de campos, tipos, obrigatoriedade, catálogos e enums, `strictObject`, limites (`min(1)`). Só as strings de descrição podem mudar, e um teste confere isso.

### Inventário do texto descritivo que o modelo lê hoje

| Fase  | Texto                                                | Onde                                | Conteúdo na V3                                                                                                                                    |
| ----- | ---------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 e 2 | prompt de sistema                                    | `../src/prompt.ts`, `SYSTEM_PROMPT` | o texto da V1                                                                                                                                     |
| 1     | descrição da `searchArticles`                        | `../src/tools.ts:51-52`             | "Busca artigos da central de ajuda de TI por palavras-chave. Use para responder dúvidas que um artigo possa resolver."                            |
| 1     | descrição da `listMyTickets`                         | `../src/tools.ts:68`                | "Lista os chamados do funcionário autenticado. Não recebe identificação: a sessão já a define."                                                   |
| 1     | descrição da `proposeTicketDraft`                    | `../src/tools.ts:83-84`             | "Propõe um rascunho de chamado para o funcionário confirmar. Só use quando todos os dados estiverem completos. Não informe prioridade nem prazo." |
| 1     | descrição da `requestHandoff`                        | `../src/tools.ts:95`                | "Pede a transferência da conversa para um analista humano."                                                                                       |
| 1     | `.describe` do argumento `query` (`searchArticles`)  | `../src/tools.ts:24`                | "Palavras-chave da dúvida do funcionário."                                                                                                        |
| 1     | `.describe` do argumento `reason` (`requestHandoff`) | `../src/tools.ts:41`                | "Motivo curto do pedido."                                                                                                                         |
| 1     | argumentos da `proposeTicketDraft`; `listMyTickets`  | `../src/tools.ts:27-39`             | sem `.describe`                                                                                                                                   |
| 2     | `interpretationSchema`                               | `../src/schema.ts`                  | sem `.describe`                                                                                                                                   |

**Também lidos pelo modelo, mas fixos (não são texto descritivo das instruções):** os nomes e os enums dos schemas; os históricos e as entradas dos casos; os resultados das tools (títulos e conteúdos dos artigos, dados dos chamados das fixtures); o texto que o próprio Mastra acrescenta para a saída estruturada.

## Fixos

Iguais à V3, por referência ao `v3/CRITERIA.md`, sem cópia:

- **Desenho:** as duas fases, os dois Agents, `toolChoice: "auto"`, `maxSteps` 5 e 1, a transcrição e a interpretação oficial ("Desenho", "Transcrição da fase 1 para a fase 2", "Interpretação oficial").
- **Estrutura dos schemas:** a do `interpretationSchema` (`../src/schema.ts`) e a do `TOOL_INPUT_SCHEMAS` (`../src/tools.ts`), como definida em "Variável".
- **Tools:** ids e comportamento (`execute`) das quatro tools falsas; fixtures (`../src/fixtures.ts`).
- **Configuração:** modelos, ordem das rodadas, temperatura, seed, saída máxima, controle de raciocínio, aquecimento, tempo limite, novas tentativas ("Modelos e ordem das rodadas", "Configuração", "Novas tentativas").
- **Instrumento:** E1–E4, invariantes I1–I10, falha do instrumento, truncamento, segurança e registros (seções homônimas).
- **Casos:** as entradas, os históricos e os estados dos seis casos do `../cases.json` (composição abaixo).
- **Regra de reexecução da V1** (`../README.md`, "Regra de reexecução"), sem mudança:
  - cada modelo roda **uma** vez; a primeira execução completa é a oficial;
  - só se repete uma execução interrompida por **falha de ambiente** (o processo caiu, a máquina hibernou, a rede caiu), nunca por resultado ruim. Erros do modelo, do provider ou de cota (`EXEC_*`) fazem parte do resultado e não autorizam repetir;
  - toda execução, inclusive a interrompida, fica em `v4/results/` e é citada no ADR, com o motivo da repetição.
- **Limitação mantida:** a estimativa de tokens da fase 1 conta os schemas das tools, não as descrições das tools (`v3/src/run.ts`, `estimatePhase1`). Uma descrição mais longa não entra na estimativa; o truncamento continua verificado pelos tokens informados pelo provider.

## Gabarito da V4

Composto: `scenario`, `history`, `state`, `input` e `inputSource` vêm do `../cases.json` (V1, sem cópia); `expected`, `justification` e, no C2, `derivation` vêm de `v4/expected.json`. O formato é o do `casesFileSchema` (`../src/cases-schema.ts`), sem mudança: os seis casos têm exatamente uma tool esperada.

### Onde as decisões se aplicam

| Caso       | Entrada               | D25                                              | D26      | D27                 |
| ---------- | --------------------- | ------------------------------------------------ | -------- | ------------------- |
| C1 (SC-01) | dúvida                | não: não é relato de falha [AF] D25, escopo      | não      | não                 |
| C2 (SC-02) | relato de falha nova  | sim: exemplo da D25 [AF]                         | não      | não                 |
| C3 (SC-04) | consulta              | não [AF] D25, escopo                             | não      | não                 |
| C4 (SC-08) | pedido de equipamento | não: é pedido, não falha [AF] D25, escopo        | sim [AF] | exemplo [AF] D27    |
| C5 (SC-13) | pedido de atendente   | não: "sem busca prévia" [AF] D25, fora do escopo | não      | não                 |
| C6 (SC-10) | relato de falha nova  | sim: exemplo da D25 [AF]                         | sim [AF] | sim [Cenário] SC-10 |

### Campos por caso

| Caso | Campo                                                                                      | Valor                                                                                                                                                                                                                                                                     | Rótulo                                                                                                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1   | intent; tool                                                                               | `ANSWER_KB`; `searchArticles`                                                                                                                                                                                                                                             | [Cenário] SC-01                                                                                                                                                                                                                                         |
| C1   | `missingFields`                                                                            | `exact []`                                                                                                                                                                                                                                                                | [Cenário] SC-01, Política `ANSWER`                                                                                                                                                                                                                      |
| C1   | termos de `query`                                                                          | palavras-chave do `ART-HORARIO`                                                                                                                                                                                                                                           | [Premissa do spike]                                                                                                                                                                                                                                     |
| C1   | argumentos de identidade                                                                   | proibidos                                                                                                                                                                                                                                                                 | [Cenário] §3, notas gerais                                                                                                                                                                                                                              |
| C2   | intent; tool                                                                               | `ANSWER_KB`; `searchArticles`                                                                                                                                                                                                                                             | [Cenário] SC-02; [AF] D25, itens 1 e 2                                                                                                                                                                                                                  |
| C2   | `operatingSystem`                                                                          | como no `../cases.json`, sem mudança em relação à V3: presença `required`; regra `normalized-contains-any` com os valores `windows10` e `win10`, comparados com o texto depois de `normalizeText` (`../src/fixtures.ts`: sem acentos, minúsculas, só letras e algarismos) | [Cenário] SC-02; [DM] §3.11                                                                                                                                                                                                                             |
| C2   | `category`                                                                                 | opcional, `NETWORK_VPN`                                                                                                                                                                                                                                                   | [DM] §3.2; [PRD] Anexo A                                                                                                                                                                                                                                |
| C2   | `problem`; termos de `query`                                                               | opcional; `vpn`/`809`                                                                                                                                                                                                                                                     | [Premissa do spike]                                                                                                                                                                                                                                     |
| C2   | `missingFields`                                                                            | `exact []`                                                                                                                                                                                                                                                                | [Cenário] SC-02                                                                                                                                                                                                                                         |
| C2   | nota de derivação                                                                          | atualizada: a `Intent` do SC-03 deixou de ser PENDENTE (D25); o SC-02 continua                                                                                                                                                                                            | [Premissa do spike] (decisão do autor)                                                                                                                                                                                                                  |
| C3   | intent; tool                                                                               | `LIST_MY_TICKETS`; `listMyTickets`, sem identidade                                                                                                                                                                                                                        | [Cenário] SC-04; [DM] §3.12; [AF] §9.1                                                                                                                                                                                                                  |
| C3   | `missingFields`                                                                            | `exact []`                                                                                                                                                                                                                                                                | [Cenário] SC-04                                                                                                                                                                                                                                         |
| C4   | intent                                                                                     | `CREATE_TICKET`                                                                                                                                                                                                                                                           | [Cenário] SC-08; [AF] D27, exemplo                                                                                                                                                                                                                      |
| C4   | `impact.affectedScope`                                                                     | `SELF`, obrigatório                                                                                                                                                                                                                                                       | [Cenário] SC-08; [AF] D26, exemplo                                                                                                                                                                                                                      |
| C4   | `workImpact` `NONE`, `commitmentRisk` `NO`, `category` `HARDWARE`, `problem` nas entidades | opcionais                                                                                                                                                                                                                                                                 | PENDENTE (entidades por turno ou acumuladas)                                                                                                                                                                                                            |
| C4   | `missingFields`                                                                            | `exact []`                                                                                                                                                                                                                                                                | [DM] §4, regra 8; [AF] D26                                                                                                                                                                                                                              |
| C4   | tool; `type`                                                                               | `proposeTicketDraft`; `REQ`                                                                                                                                                                                                                                               | [Cenário] SC-08; [AF] D26; [PRD] Anexo A                                                                                                                                                                                                                |
| C4   | `category` nos argumentos                                                                  | `HARDWARE`                                                                                                                                                                                                                                                                | [AF] D26 ("pedido de monitor → categoria `HARDWARE`")                                                                                                                                                                                                   |
| C4   | impacto nos argumentos                                                                     | `SELF` + `NONE` + `NO`                                                                                                                                                                                                                                                    | [Cenário] SC-08; [AF] D26 (só o declarado)                                                                                                                                                                                                              |
| C4   | termos de `title` e `description`                                                          | os 8 termos da V3                                                                                                                                                                                                                                                         | [Premissa do spike]                                                                                                                                                                                                                                     |
| C4   | prioridade, prazo e identidade nos argumentos                                              | proibidos                                                                                                                                                                                                                                                                 | [DM] §7.1, invariante 3; [AF] D26                                                                                                                                                                                                                       |
| C4   | histórico sintético; ordem das perguntas                                                   | iguais à V3                                                                                                                                                                                                                                                               | [Premissa do spike]; PENDENTE (AF P-D)                                                                                                                                                                                                                  |
| C5   | intent; tool                                                                               | `HANDOFF`; `requestHandoff`, `reason` opcional                                                                                                                                                                                                                            | [Cenário] SC-13                                                                                                                                                                                                                                         |
| C5   | busca                                                                                      | não esperada                                                                                                                                                                                                                                                              | [AF] D25 ("sem busca prévia")                                                                                                                                                                                                                           |
| C5   | proposta                                                                                   | não esperada                                                                                                                                                                                                                                                              | [DM] §7.1, invariante 7                                                                                                                                                                                                                                 |
| C5   | `missingFields`                                                                            | `exact []`                                                                                                                                                                                                                                                                | [Cenário] SC-13                                                                                                                                                                                                                                         |
| C6   | intent                                                                                     | `CREATE_TICKET`, **em qualquer caso**, inclusive quando a busca devolve um artigo que não trata do problema                                                                                                                                                               | [AF] D25, itens 1 e 3, e esclarecimento de 2026-11-16; [AF] D27; [Cenário] SC-10                                                                                                                                                                        |
| C6   | `impact.workImpact`                                                                        | `BLOCKED`, obrigatório                                                                                                                                                                                                                                                    | [Cenário] SC-10; [AF] D26, exemplo                                                                                                                                                                                                                      |
| C6   | `impact.affectedScope`                                                                     | ausente                                                                                                                                                                                                                                                                   | [Cenário] SC-10; [AF] D26, exemplo                                                                                                                                                                                                                      |
| C6   | `impact.commitmentRisk`                                                                    | ausente ou `NOT_ASKED` (estado de coleta)                                                                                                                                                                                                                                 | [DM] §4                                                                                                                                                                                                                                                 |
| C6   | `category`                                                                                 | **ausente**                                                                                                                                                                                                                                                               | [AF] D26, por derivação                                                                                                                                                                                                                                 |
| C6   | `problem`                                                                                  | opcional                                                                                                                                                                                                                                                                  | [Premissa do spike]                                                                                                                                                                                                                                     |
| C6   | `missingFields`                                                                            | `includes`; `required` [`AFFECTED_SCOPE`, `CATEGORY`]; `forbidden` [`WORK_IMPACT`, `COMMITMENT_RISK`, `TYPE`]                                                                                                                                                             | `AFFECTED_SCOPE`: [Cenário] SC-10, [DM] §4 regra 1, [AF] D26; `CATEGORY` e `TYPE`: [AF] D26, por derivação (regra do tipo; "sem evidência suficiente, o campo entra no `missingFields`"); `WORK_IMPACT`: [AF] D26; `COMMITMENT_RISK`: [DM] §4, [AF] D26 |
| C6   | `TITLE` e `DESCRIPTION` no `missingFields`                                                 | neutros na pontuação: nem aprovados nem rejeitados. A regra geral da D26 continua válida; o gabarito não determina se a entrada do C6 traz evidência suficiente para esses campos                                                                                         | [AF] D26 (regra geral); PENDENTE (evidência na entrada do C6)                                                                                                                                                                                           |
| C6   | tool                                                                                       | `searchArticles`                                                                                                                                                                                                                                                          | [AF] D25, item 1; [Cenário] SC-10                                                                                                                                                                                                                       |
| C6   | `query`                                                                                    | obrigatória e não vazia (o schema já exige); conteúdo não avaliado (regra `any`)                                                                                                                                                                                          | [Premissa do spike]: "Parou tudo!" não traz termos de busca, e a especificação não define a consulta                                                                                                                                                    |
| C6   | argumentos de identidade                                                                   | proibidos                                                                                                                                                                                                                                                                 | [Cenário] §3, notas gerais                                                                                                                                                                                                                              |

### Diferenças em relação ao gabarito da V3

Só estas (o teste de composição exige que sejam as únicas):

- **C6:** `expectedTool` `none` → `searchArticles`, com `toolArgs` (`query` obrigatória, regra `any`; identidade proibida); `category` nas entidades passa a `absent`; `missingFields.required` ganha `CATEGORY`; `missingFields.forbidden` ganha `TYPE`.
- **C2:** a nota de derivação.
- **Todos:** `justification` (fontes e rótulos) e os metadados do arquivo (`version`, `frozenAt`, `notes`).

## Pontuação

- **Métricas por turno:** as da V3, sem mudança: o `scoreTurnV3` (`v3/src/score.ts`), que aplica o `scoreTurn` da V1 sobre a vista V1, com o gabarito composto.
- **Métrica de tool:** mede a precisão da mesma forma nos seis casos: as tools esperadas, sem extras. Qualquer tool não esperada reprova, inclusive a `listMyTickets` no C6 [Premissa do spike].
- **Validação da interpretação e das chamadas:** pelos schemas da V1. Como a estrutura dos schemas é a mesma, o veredito é o mesmo com as descrições da V4.
- **Chave de estabilidade:** sem mudança (intenção + conjunto de tools de negócio).

### Critério C6 (novo)

**Condições do C6 da V1/V3**, no `../src/score.ts`:

1. turno sem `EXEC_*`, inclusive truncamento detectado e efeito externo (linhas 115-145: com `EXEC_*`, o C6 é falso);
2. interpretação válida pelo Zod (linha 173);
3. `impact.workImpact` = `BLOCKED` (linha 174);
4. `impact.affectedScope` ausente (linha 175);
5. **nenhuma chamada de tool de negócio**, válida ou recusada (`businessToolCalls.length === 0`, linha 176);
6. `missingFields` contém `AFFECTED_SCOPE` (linha 177).

O C6 da V1/V3 **não** exige a intenção, nem `commitmentRisk`, `category` ou `problem`, nem a ausência de vazamento (que é da tolerância zero), e não considera os nomes desconhecidos (`otherToolCalls`).

**C6 da V4:** as condições 1 a 4 e 6, **iguais**; a condição 5 é **substituída** pela regra de segurança [Premissa do spike]:

- **Segurança:** nenhuma emissão na fase 1, válida ou recusada, executada ou não, de:
  - `proposeTicketDraft` [AF] D26 e D27; [Cenário] SC-10;
  - `requestHandoff` [Cenário] SC-10, Política `ASK` (derivação);
  - nome de tool desconhecido (`otherToolCalls` da vista V1) [Premissa do spike].

Fora do C6:

- a **busca** (`searchArticles`) é exigida pela métrica de tool, não pelo C6;
- a **`listMyTickets`** não reprova o C6; reprova a métrica de tool;
- `CATEGORY`, `TYPE` e `category` ausente pesam na métrica de entidades, não no C6.

**Diferença declarada em relação à V3:** na V3, um nome inventado não reprovava o C6 (só a métrica de tool), e qualquer tool de negócio reprovava. Na V4, o nome inventado reprova, e a `searchArticles` e a `listMyTickets` não.

### Diagnóstico do C6 (não pontua)

Para cada turno do C6, o estado da busca, em um destes valores explícitos:

| Estado             | Significado                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NOT_CALLED`       | nenhuma chamada da `searchArticles` na fase 1                                                                                                              |
| `REJECTED`         | chamada recusada pela validação (não executou)                                                                                                             |
| `NO_RESULT`        | chamada executada, sem artigo devolvido                                                                                                                    |
| `RESULTS`          | chamada executada, com artigos devolvidos; o diagnóstico diz quais (ids)                                                                                   |
| `NOT_RECALCULABLE` | a consulta registrada está indisponível, foi alterada pela remoção de raciocínio, ou a chamada é válida sem execução registrada; o motivo fica em `reason` |

- Os artigos são recalculados a partir da consulta registrada, com o mesmo filtro da tool falsa (determinístico: palavra-chave contida na consulta normalizada).
- Com mais de uma chamada no turno, o diagnóstico lista o estado de cada uma, na ordem de emissão.
- **A ausência de chamada nunca aparece como busca sem resultado:** `NOT_CALLED` e `NO_RESULT` são estados distintos.

## Limites de aprovação

Iguais à V3, pelo `aggregate` da V1 sem alteração, com o C6 novo:

- interpretação válida pelo Zod: ≥ 17 de 18;
- intenção correta: ≥ 15 de 18 e maioria correta em ≥ 5 de 6;
- tool de negócio correta: ≥ 15 de 18 e maioria correta em ≥ 5 de 6;
- entidades e `missingFields`: ≥ 15 de 18;
- estabilidade: mesma intenção e mesmo conjunto de tools nas 3 repetições em ≥ 4 de 6, e ≥ 2 concordantes nas demais;
- C6: as 3 execuções com o C6 da V4;
- vazamento de raciocínio, truncamento e efeitos externos: zero;
- E1–E4 e nenhuma violação de invariante.

Nenhum limiar depende de uma contagem que muda: os denominadores continuam 18, 6 e 3. Mudam o conteúdo da métrica de tool (C6 exige a busca), o da métrica de entidades (C6 mais rígido) e a condição de tools do C6 [Premissa do spike].

## Leitura dos resultados

- **A aprovação vem só dos limites** acima. Nenhuma comparação com a linha de base aprova ou reprova um candidato.
- **A comparação com a linha de base é descritiva:** as mesmas métricas, lado a lado, com o mesmo gabarito e a mesma régua. Ela mostra o efeito observado da troca das instruções, sem limiar de melhora e sem teste estatístico (3 repetições por caso não sustentam inferência).
- **A V4 mede o efeito conjunto** do prompt, das descrições das tools e dos `.describe`. Ela não permite atribuir o resultado a cada parte isoladamente.
- O relatório da linha de base é não oficial; o resultado oficial da V4 é o das rodadas da V4.

## O que as instruções devem ensinar

Regras gerais, cada uma com a fonte. As instruções da V1 que continuam válidas ficam (identidade, prioridade e prazo, proposta só completa, transferência a pedido, raciocínio não exposto, tipos, escopo, catálogos).

**Fase 1 (conduzir o turno e executar as tools):**

1. Relato de falha nova, sem pedido expresso de chamado nem de pessoa: buscar na central de ajuda antes de decidir, inclusive quando o relato traz pouca informação [AF] D25, item 1.
2. Artigo aplicável é o que trata do problema relatado e passa o filtro de `applicability`. Artigo devolvido que não trata do problema conta como "sem artigo aplicável" [AF] D25, item 2, e esclarecimento de 2026-11-16.
3. Com artigo aplicável: responder pelo artigo e oferecer abrir um chamado se a orientação não resolver, sem propor nada nesse turno [AF] D25, item 2.
4. Sem artigo aplicável: começar a coleta do chamado [AF] D25, item 3.
5. Dúvida: buscar na central de ajuda [Cenário] SC-01.
6. Consulta de chamado sem o número: listar os próprios chamados (`LIST_MY_TICKETS`, `listMyTickets`). `VIEW_TICKET` só com o chamado identificado [AF] §9.1; [Cenário] SC-04. (O spike não tem a tool de consulta detalhada, cujo nome é PENDENTE nos cenários.)
7. Pedido expresso de falar com uma pessoa: `requestHandoff`, sem busca prévia [AF] D25. Pedido expresso de chamado: coleta, haja ou não artigo [AF] D25.
8. Campos descritivos (título, descrição, tipo, categoria): preparar a partir da conversa, sem perguntar, quando houver evidência suficiente; título e descrição sem fatos que a conversa não sustente; perguntar o que não tiver evidência [AF] D26.
9. Campos de impacto: só o que o funcionário declarou; normalizar uma resposta direta e sem ambiguidade; nunca deduzir um campo de outro; com `BLOCKED`, não perguntar sobre compromisso [AF] D26; [DM] §4.
10. `proposeTicketDraft` só com o rascunho completo; nunca prioridade nem prazo [AF] D26; [DM] §7.1.

**Fase 2 (interpretar a transcrição, sem tools):**

11. A intenção reflete o turno inteiro, inclusive o resultado da busca num relato de falha nova: com artigo aplicável, `ANSWER_KB` [AF] D25, item 2; sem artigo aplicável, `CREATE_TICKET` [AF] D25, item 3.
12. `CLARIFY` só quando não for possível identificar a intenção ou a operação; com a operação identificada e dados faltando, a intenção é a da operação, e os dados vão para o `missingFields` [AF] D27.
13. O `missingFields` da interpretação lista o que falta para a ação, inclusive os campos descritivos sem evidência; não é a regra de campo único da `classifyPriority` [AF] D26; [DM] §4.
14. Entidades: preencher apenas o que a conversa sustenta. A categoria pode ser classificada a partir do que o funcionário descreveu, quando houver evidência suficiente; sem isso, fica ausente e entra em `missingFields`. Os campos de impacto seguem o item 9 [AF] D26.

**Descrições das tools e dos argumentos:** coerentes com os itens acima. Hoje, a descrição da `searchArticles` ("Use para responder dúvidas que um artigo possa resolver.") e o `.describe` do `query` ("Palavras-chave da dúvida do funcionário.") não cobrem o relato de falha da D25.

**Não ensinar:** o tratamento da busca que falhou (PENDENTE, AF P-G; a tool falsa nunca falha); quem julga a pertinência ou garante a busca (a D25 não define; o spike mede o modelo).

## Regra contra vazamento do gabarito

As instruções ensinam regras gerais; **não contêm o gabarito** [Premissa do spike]. Vale para todo o texto da variável: o prompt, as descrições das tools e os `.describe`.

- **Proibido:**
  1. qualquer frase do funcionário dos seis casos (as `input` e os turnos `user` dos históricos), quando a forma normalizada tiver 8 caracteres ou mais;
  2. os termos aceitos em `title` e `description` do C4;
  3. das fixtures: os ids e os títulos dos artigos e dos chamados, e trechos literais dos conteúdos, quando a forma normalizada do trecho tiver 8 caracteres ou mais. Palavras soltas comuns (por exemplo, "atendimento" ou "funcionamento") **não** são banidas por este item;
  4. termos isolados, só estes (formas normalizadas): `monitor`, `809` e `horario`, que identificam os casos C4, C2 e C6 ou o artigo da armadilha do C6;
  5. os exemplos do AF que coincidem com entradas dos casos (por exemplo, "Parou tudo!", "Preciso de um segundo monitor.", "Só para mim.", o artigo de horário do esclarecimento da D25), mesmo como ilustração de uma regra.
- **Permitido:** os catálogos e os significados que já estão nas instruções da V1 (tipos, categorias, impacto, `missingFields`), e as regras das D25–D27 em termos gerais.
- **Verificação automática:** um teste normaliza (`normalizeText`) o prompt, cada descrição de tool e cada `.describe`, e confere a ausência dos itens 1 a 4. O mesmo teste roda sobre o texto da V1 e precisa passar (controle: a regra não reprova a linha de base).
- **Limite do teste:** ele só encontra texto literal. Não pega associação disfarçada (paráfrase de uma entrada, exemplo que leva à resposta de um caso sem repetir as palavras).
- **Revisão humana antes do congelamento das instruções**, com esta lista de verificação:
  - nenhum exemplo reproduz a entrada de um caso, nem por paráfrase;
  - nenhum exemplo reproduz a resposta esperada de um caso (intenção, tool, campos, valores), nem por paráfrase;
  - nenhum exemplo do AF que coincide com um caso aparece nas instruções;
  - nenhuma regra é específica de um caso: cada uma vale para a classe de entradas descrita na fonte citada.
- **Estado da revisão humana: feita.**
  - **Data:** 2026-11-19.
  - **Revisor:** Celio Junior (autor).
  - **Arquivos:** `v4/src/prompt.ts` e `v4/src/descriptions.ts`.
  - **Método:** cada caso comparado com as regras e descrições mais próximas dele.
  - **Nenhum exemplo reproduz a entrada de um caso, nem por paráfrase:** aprovado. O prompt e as descrições não têm exemplos.
  - **Nenhum exemplo reproduz a resposta esperada de um caso:** aprovado. Pelo mesmo motivo; o exemplo da D26 "pedido de monitor → HARDWARE" não entrou.
  - **Nenhum exemplo do AF que coincide com um caso aparece:** aprovado.
  - **Nenhuma regra é específica de um caso:** aprovado, com estas observações:
    - C1: a regra de dúvida é da V1, sem mudança, sem citar horário nem o artigo.
    - C2: aplicabilidade e intenção em termos gerais; rede e VPN só aparecem no catálogo de categorias da V1 (NETWORK_VPN, "rede e VPN"), inalterado e permitido pelo CRITERIA.
    - C3: a regra do `listMyTickets` ("sem informar o número") é a mais próxima de um caso; vem da história 2 do README e do AF §9.1, sem "status" nem as palavras da entrada. Aparece no prompt e na descrição da tool, como as regras da `searchArticles` e da `requestHandoff`; mantida pela simetria.
    - C4: REQ "pedido de equipamento" é da V1; categoria e impacto em termos gerais.
    - C5: a regra da `requestHandoff` é da V1; a V4 só acrescentou "sem buscar antes" (D25), sem "atendente" nem o rascunho aberto.
    - C6: "mesmo que o relato traga poucos detalhes" vem quase literal da D25, item 1, e foi mantida porque descreve uma classe de relatos; "um artigo que trata de outro assunto conta como nenhum aplicável" é a regra do esclarecimento da D25, sem exemplo e sem citar horário. "Parou" e "parado" aparecem só nos significados da V1 de INC e BLOCKED, inalterados e permitidos pelo CRITERIA.

## Linha de base (repontuação da V3)

Script `v4/baseline/rescore.ts`, **somente leitura**:

1. confere o manifesto da V3 (33/33) com o `verifyManifestV3` importado;
2. calcula o sha256 dos dois `.jsonl` oficiais (`v3/results/ollama-qwen3-4b-instruct/2026-11-14T14-12-46-951Z.jsonl` e `v3/results/ollama-qwen3-8b/2026-11-14T14-15-14-181Z.jsonl`);
3. lê os registros com `readFileSync`, só as linhas `"turn"`;
4. pontua com o `scoreTurnV4` e o gabarito composto, e calcula o diagnóstico do C6;
5. confere de novo os hashes;
6. grava `v4/results/linha-de-base-<data>.md`, com o cabeçalho "não oficial: repontuação dos registros oficiais da V3 com o gabarito e a régua da V4". Nada é gravado em `v3/`.

## Estrutura

### Etapa 1: gabarito e régua

| Arquivo                   | Conteúdo                                                                                                                                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v4/expected.json`        | `expected`, `justification` e `derivation` (C2) por caso; `version`, `frozenAt`, `notes`                                                                                                                                                                                                                            |
| `v4/src/cases.ts`         | composição com o `../cases.json` e validação (`casesFileSchema` e catálogos)                                                                                                                                                                                                                                        |
| `v4/src/catalog-check.ts` | **exceção controlada 2:** cópia do trecho do `../src/check-cases.ts` (o mapa `CATALOG_BY_PATH` e o laço de verificação por caso) numa função exportada `checkCatalogs(file: CasesFile): string[]`. Motivo: o original é um script com o caminho `../cases.json` fixo e código no nível superior, sem nada exportado |
| `v4/src/score.ts`         | `scoreTurnV4(record, case, c6Rule = c6V4)`: chama o `scoreTurnV3` e substitui só o `v1.c6Expected` no C6; `c6V3` reproduz a regra da V3 (para o teste de equivalência); `aggregateV4` = `aggregateV3`; diagnóstico do C6                                                                                            |
| `v4/baseline/rescore.ts`  | linha de base (seção anterior)                                                                                                                                                                                                                                                                                      |
| `v4/tsconfig.json`        | como o da V3                                                                                                                                                                                                                                                                                                        |
| testes                    | ver "Plano de testes"                                                                                                                                                                                                                                                                                               |

**Reaproveitados por import, sem cópia:**

- da V1: `casesFileSchema` e `CasesFile` (`../src/cases-schema.ts`); `aggregate`, `TurnScore`, `valueAt` (`../src/score.ts`); `interpretationSchema`, `INTENTS`, `MISSING_FIELDS` e os catálogos (`../src/schema.ts`); `normalizeText` e `ARTICLES` (`../src/fixtures.ts`); `TOOL_INPUT_SCHEMAS` (`../src/tools.ts`);
- da V3: `scoreTurnV3`, `aggregateV3`, `toV1View`, tipos de `record.ts`, `verifyManifestV3`.

### Etapa 2: instruções

| Arquivo            | Conteúdo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v4/src/prompt.ts` | `SYSTEM_PROMPT` novo e `PROMPT_VERSION` da V4, com as fontes de cada regra em comentário                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `v4/src/tools.ts`  | `TOOL_INPUT_SCHEMAS_V4`: os schemas da V1 com **só** os `.describe` trocados (ou acrescentados); `createFakeToolsV4()`: parte do `createFakeTools()` da V1 e recria cada tool com `createTool`, mudando a `description` e usando o schema da V4; reaproveita o `id` e o `execute` original (que registra as chamadas no `toolLog`). A forma exata depende do objeto que o Mastra devolve; conferir na implementação                                                                                                                 |
| `v4/src/schema.ts` | **só se** as instruções acrescentarem `.describe` à interpretação: `interpretationSchemaV4`, o `interpretationSchema` da V1 com só as descrições, usado na saída estruturada da fase 2. Sem descrições novas, a V4 importa o da V1 e este arquivo não existe                                                                                                                                                                                                                                                                        |
| `v4/src/run.ts`    | **exceção controlada 1:** cópia do `v3/src/run.ts`, que existe **só para trocar as instruções**. O `run.ts` da V3 importa o `SYSTEM_PROMPT`, o `createFakeTools`, o `TOOL_INPUT_SCHEMAS` e o `interpretationSchema` diretamente (linhas 24, 39, 40, 188–189, 276), sem ponto de injeção. Diferenças autorizadas: imports (prompt, tools e schemas da V4, pontuação, composição dos casos), caminhos (raiz, resultados, CRITERIA, manifesto), ids dos Agents e cabeçalho do registro (versão da V4, versão do prompt). Nenhuma outra |

- A validação no momento da captura (`validityOf`, `v2/src/protocol.ts`), a política de vazamento e a pontuação continuam com os schemas da V1. Como a estrutura é a mesma, o veredito é o mesmo.
- Os demais módulos da V3 (`phase2.ts`, `transcript.ts`, `record.ts`, `score.ts`) são importados sem cópia.

## Plano de testes

Com o dublê do Mastra, sem modelo real.

**Composição dos casos (`cases.test.ts`):**

1. ids exatamente {C1, C2, C3, C4, C5, C6}: sem falta, sem repetição, sem extra (no `expected.json` e no gabarito composto);
2. `scenario`, `history`, `state`, `input` e `inputSource` idênticos aos do `../cases.json`, por comparação profunda;
3. `casesFileSchema.parse` do gabarito composto;
4. `checkCatalogs` sem problemas;
5. caminhos das regras válidos: os de `entities` existem no `interpretationSchema`, e os de `toolArgs.fields` existem no schema de entrada da tool esperada, inclusive nas regras `absent`. Os nomes de `toolArgs.forbidden` ficam de fora, porque por definição não existem no schema (prioridade, identidade);
6. `missingFields.required` ∩ `missingFields.forbidden` vazio;
7. `expected` diferente do da raiz só nos campos listados em "Diferenças em relação ao gabarito da V3".

**Checagem de catálogos (`catalog-check.test.ts`):**

- aceita o `../cases.json` da raiz (zero problemas);
- recusa variações quebradas, uma por problema: intent fora do catálogo; `missingField` fora do catálogo; valor `equals` fora do catálogo do caminho; valor `normalized-contains-any` não normalizado; argumentos inválidos numa chamada do histórico; estado com `PendingAction` sem a proposta correspondente; proposta no histórico sem `PendingAction` no estado; cenário repetido;
- o trecho copiado é idêntico ao do `../src/check-cases.ts`, linha a linha, descontada a indentação da função.

**Pontuação (`score.test.ts`):** um teste positivo e um negativo para cada condição do C6 da V4:

- só a `searchArticles` → segurança aprovada;
- `listMyTickets` → segurança aprovada, métrica de tool reprovada;
- `proposeTicketDraft` válida e recusada → segurança reprovada;
- `requestHandoff` → segurança reprovada;
- nome desconhecido → segurança reprovada;
- cada uma das condições 1 a 4 e 6, isolada (inclusive turno com `EXEC_*`);
- diagnóstico: um teste para cada estado (`NOT_CALLED`; `REJECTED`; `NO_RESULT`; `RESULTS` com o `ART-HORARIO`; `NOT_RECALCULABLE`), mais um turno com duas chamadas em estados diferentes.

**Equivalência (`equivalence.test.ts`):** com o gabarito da raiz (o da V3, no mesmo schema) e `c6Rule = c6V3`, nos dois registros oficiais:

- por turno, `scoreTurnV4` igual a `scoreTurnV3(...).v1` (comparação profunda: Zod, intenção, tool, entidades, C6, códigos, chave de estabilidade);
- `aggregateV4` igual a `aggregateV3`;
- contagens iguais às dos `*-summary.md` oficiais.

**Ponta a ponta (`run.test.ts`, etapa 2):**

- nome de tool inventado pelo `runAttempt` da V4, com modelo roteirizado no C6: aparece em `emitted`, vai para `otherToolCalls` na vista V1, não executa (`toolLog` vazio) e reprova a segurança do C6;
- um turno C6 roteirizado com `searchArticles` e interpretação correta: aprovado em tudo;
- corpo da fase 2 (`phase2-body.test.ts`, criado na Etapa 2A pelo `runAttempt` da V3): na Etapa 2B, o mesmo teste passa a rodar também pelo `runAttempt` da V4, com as mesmas quatro asserções (tool call no `assistant`; mensagem `tool` com o mesmo `tool_call_id` e o resultado contendo `ART-HORARIO`; texto final ausente; `tools` ausentes na fase 2).

**Instruções (etapa 2):**

- **schemas, V3 × V4:** para as quatro tools e para a interpretação, o `z.toJSONSchema` da V1 e o da V4 são iguais depois de remover as anotações `description`. A remoção vale só para a palavra-chave do JSON Schema, não para propriedades chamadas `description` (a `proposeTicketDraft` tem um argumento com esse nome);
- `run.ts`: diferença linha a linha contra o `v3/src/run.ts`; cada linha diferente pertence à lista autorizada;
- `tools.ts`: ids e `execute` iguais aos da V1; o `toolLog` continua registrando;
- vazamento do gabarito (seção própria), com o texto da V1 como controle;
- o prompt chega às duas fases, as descrições das tools e dos argumentos só à fase 1, e os `.describe` da interpretação (se houver) à fase 2, conferido no corpo capturado.

**Herdados da V3:** as invariantes, a falha do instrumento, a transcrição e o truncamento são do código importado; a V4 roda a suíte da V3 sem mudança e acrescenta um teste do fecho do manifesto da V4.

## Pendências

- **Entidades por turno ou acumuladas (C4):** PENDENTE. O gabarito trata como opcionais as entidades de turnos anteriores ou não exigidas pelo cenário (C2: `category`, `problem`; C4: `workImpact`, `commitmentRisk`, `category`, `problem`; C6: `problem`, `commitmentRisk`).

## Limitações declaradas

- **Quem garante a busca e quem julga a pertinência** (D25, item 1, e esclarecimento): a especificação não define. O spike mede o modelo.
- **Busca que falhou** (D25, item 4; AF P-G): não exercitada; a tool falsa nunca falha.
- **Título, descrição e tipo antes da proposta** (AF P-H): não há campo na interpretação; só são conferidos nos argumentos da `proposeTicketDraft` (C4). Por isso `TITLE` e `DESCRIPTION` são neutros no C6.

## Ajustes da implementação (Etapa 1)

O que mudou em relação ao texto aprovado em 2026-11-16, depois da implementação da Etapa 1. **Onde houver diferença, esta seção prevalece sobre o texto acima.** Nenhum ajuste muda o gabarito, os limiares, a estrutura nem os arquivos da V1, da V2.1 e da V3.

1. **Chamada válida sem execução registrada.** Uma chamada da `searchArticles` válida na captura, sem evento `EXECUTED` correspondente (por exemplo, quando a tentativa termina no meio do passo), fica `NOT_RECALCULABLE`, com o motivo "chamada válida sem execução registrada". Os três motivos de `NOT_RECALCULABLE` ficam no campo `reason` do diagnóstico: "consulta alterada pela remoção de raciocínio", "consulta indisponível" e "chamada válida sem execução registrada". A tabela de estados foi atualizada.
2. **Remoção de raciocínio sinalizada por turno.** O registro da V3 só tem um sinal por turno (`phase1.reasoning.leakedInArgs`), não por chamada. Com o sinal marcado, todas as buscas executadas do turno ficam `NOT_RECALCULABLE`.
3. **Consulta usada no recálculo.** O recálculo usa o argumento da execução (o que a tool falsa recebeu, `phase1.executions[].args`), e não o `rawArgs` emitido; os dois passam pela mesma remoção de raciocínio. Um teste confirma que o filtro do recálculo devolve os mesmos artigos que a tool falsa, para as mesmas consultas.
4. **Condições 1–4 e 6 do C6.** Não são uma cópia das regras: saem do `c6Expected` do `scoreTurn` da V1, calculado sobre a vista V1 sem as chamadas de negócio (o que torna a condição 5 sempre verdadeira e deixa as demais intactas). O teste de decomposição, nos dois registros oficiais, confere que essas condições, junto com "zero tools de negócio", reproduzem o C6 oficial da V3.
5. **Detalhes de forma:**
   - `v4/src/cases.ts` tem um schema mínimo próprio para o `expected.json` (forma do arquivo e chaves permitidas); o caso composto é validado pelo `casesFileSchema` da V1 e pela checagem de catálogos;
   - a regra `category: absent` do C6 está no fim da lista de entidades;
   - o `TurnScoreV4` acrescenta o campo `c6` (segurança, demais condições e diagnóstico da busca; `null` fora do C6);
   - os testes da V4 importam os ajudantes de `v3/src/test-helpers.ts` e o `summaryMarkdown` de `v3/src/run.ts`, sem alteração.
6. **Prova extra na equivalência.** Além da comparação por turno e da agregação, as pontuações da V4 (com o gabarito da raiz e o C6 da V3) passam pelo `summaryMarkdown` da V3, e o resumo gerado é **idêntico byte a byte ao `*-summary.md` oficial** nos dois registros.

## Ajustes da implementação (Etapa 2A)

O que a Etapa 2A (prompt, descrições e verificação de vazamento) definiu ou constatou em relação ao texto acima. **Onde houver diferença, esta seção prevalece.** Nenhum ajuste muda o gabarito, os limiares, a estrutura nem os arquivos congelados.

1. **Verificação 0: a fase 2 recebe os resultados das tools.** A regra 11 e a frase do prompt "com as chamadas de ferramenta e os resultados" dependem disso.
   - **Código:** `v3/src/transcript.ts:18-31` (`filterTranscript`: mantém as mensagens `assistant` com tool calls e as mensagens `tool`, remove o raciocínio e exclui a última `assistant` sem tool call, o texto final do atendimento); `v3/src/run.ts:265` (a transcrição vem de `p1.response.messages`); `v3/src/run.ts:275` (a fase 2 recebe `[...messages, ...transcript]`).
   - **Lacuna dos testes da V3 no item (b):** `transcript.test.ts:17-29` mostra mensagens `tool` mantidas, mas só com resultados de erro e só na transcrição; `phase2.test.ts:79-85` e `transcript.test.ts:170-180` conferem, no corpo real, só os papéis (`assistant`, `tool`), sem o conteúdo. Nenhum teste da V3 provava que o resultado da tool, com conteúdo identificável, chega ao corpo da fase 2.
   - **Teste novo:** `v4/src/phase2-body.test.ts`, pelo `runAttempt` da V3 (HTTP fabricado, sem modelo), no C1: (a) a mensagem `assistant` do corpo da fase 2 traz o tool call da `searchArticles`; (b) a mensagem `tool` seguinte tem o mesmo `tool_call_id` e o resultado contém `ART-HORARIO`; (c) o texto final do atendimento está ausente; e o corpo da fase 2 não tem `tools`. Passa. Na Etapa 2B, roda também pelo `runAttempt` da V4 ("Plano de testes").
2. **Item 1 da regra contra vazamento, operacionalizado:** cada entrada e cada turno do funcionário nos históricos, **inteiros e também por frase** (separada por `.`, `!` ou `?`), quando a forma normalizada tiver 8 caracteres ou mais; comparação como substring do texto normalizado.
3. **Item 3, operacionalizado:** ids e títulos das fixtures, em qualquer tamanho, como substring. Dos conteúdos dos artigos, os trechos de **3 ou mais palavras** seguidas com forma normalizada total de **8 ou mais caracteres**:
   - **geração:** a partir de cada palavra do conteúdo, é cadastrada a **menor** sequência que atende às duas condições (a janela é estendida palavra a palavra até atingir 3 palavras e 8 caracteres; se o conteúdo acabar antes, nada é cadastrado a partir dessa palavra);
   - **cobertura completa:** todo trecho proibido começa em alguma palavra e contém, como prefixo, a sequência mínima cadastrada a partir dela; detectar a sequência mínima basta. Isso cobre, por exemplo, um trecho de 4 palavras com 8 caracteres cujas janelas de 3 palavras ficam abaixo de 8, que janelas fixas de 3 não pegariam;
   - **deduplicação** pela sequência de palavras normalizadas, não pela string colada: sequências com a mesma concatenação e fronteiras diferentes ficam as duas;
   - **comparação palavra a palavra**, que evita falso positivo de fronteira: "do service desk", na primeira linha do prompt da V1, não casa com o trecho "O service desk" do artigo só porque "do" termina em "o". Na primeira versão, comparada como substring do texto todo junto, essa fronteira reprovava o controle da V1;
   - **o que é palavra:** um token separado por espaço em branco (`split(/\s+/)`), normalizado individualmente (`normalizeText`). Palavras com hífen ou apóstrofo viram um único token (por exemplo, "sexta-feira" → `sextafeira`); a quase-cópia com separação diferente (por exemplo, "sexta feira") não casa e fica para a revisão humana.
4. **Limite do item 3:** fragmentos de 1 ou 2 palavras dos conteúdos não são detectados; ficam para a revisão humana. Os termos isolados que identificam casos estão no item 4. O teste tem casos de fronteira:
   - detectados: pontuação diferente; acentos; sequência de 4 palavras com 8 caracteres e janelas de 3 abaixo de 8; duas sequências com a mesma concatenação e fronteiras diferentes (as duas);
   - não detectados: frase abaixo de 8 caracteres; fronteira de palavra diferente ("do service desk"); fragmento de 2 palavras sem termo do item 4.
   - Os casos de geração usam conteúdos fabricados no próprio teste; as fixtures não mudam.

## Ordem de trabalho

1. Este CRITERIA → revisão e aprovação.
2. Etapa 1: gabarito composto, checagem de catálogos, pontuação, testes (inclusive a equivalência).
3. **Congelamento do gabarito e da régua, com commit próprio**: hashes de `v4/expected.json`, `v4/src/cases.ts`, `v4/src/catalog-check.ts` e `v4/src/score.ts` registrados aqui. Vem **antes da linha de base e antes de escrever as instruções** [Premissa do spike].

   **Estado: aguardando commit.** SHA-256 em 2026-11-16 (fins de linha LF), na pasta `spikes/llm-model/`:

   | Arquivo | SHA-256 |
   | --- | --- |
   | `v4/expected.json` | `e54500ef8e823f611eabead35743352fdcc8bff06c55225bb68853293479e665` |
   | `v4/src/cases.ts` | `d30f7d976a24f07b0867f2c468d850e7dc3ad2d42a48f6aa9e54264f3c7bab29` |
   | `v4/src/catalog-check.ts` | `6042fcb68502b720bb15ca078c6372a698f40b6a66c3f4962d7569cf0a4bfdea` |
   | `v4/src/score.ts` | `77c1980bc9cb7f733cee3def330fac777f70ca5dd475eed7242908ebf7be8702` |
   | `v4/tsconfig.json` | `f5341fee9a82dbb323df727fcf12c4922612cc94d313f5298194f1b6fba7b806` |
   | `v4/src/cases.test.ts` | `52e8dedfbd458e1ef2aeb389aae510ebe9c31bb80ca4fee823d340d87fae0fd5` |
   | `v4/src/catalog-check.test.ts` | `10cc7e428e7719daa18f115e96f48c486224c8c668be38b542dc1ff12ceb7534` |
   | `v4/src/score.test.ts` | `7216f9db7553be4f816d59ba842a235c36bc1f7b6a0a3eaadb1fde42e5d3343b` |
   | `v4/src/equivalence.test.ts` | `34d643ba969b881625340e9e12cccb709913db4d7d46c5b85be952663d935d8e` |
4. Linha de base: repontuação dos registros da V3 e relatório não oficial.
5. Etapa 2: instruções (prompt, descrições das tools, `.describe`), cópia controlada do `run.ts`, testes, revisão humana contra vazamento.
6. Manifesto completo da V4 e commit de congelamento.
7. Rodadas (executadas pelo autor, pela regra de reexecução): `qwen3:4b-instruct`, depois `qwen3:8b`.

## Arquivos (manifesto)

A definir no congelamento, com o mesmo critério da V3: entra todo arquivo carregado na execução ou nos testes da V4, com os hashes da V1, da V2.1 e da V3 para os importados.
