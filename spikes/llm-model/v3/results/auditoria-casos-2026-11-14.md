# Auditoria dos casos C1–C6 contra a especificação (2026-11-14)

> Relatório do agente, feito só por leitura: nada rodado, nada alterado e sem commit. Texto original; só as tabelas foram convertidas para Markdown. Deu origem às decisões D25–D27 (AF v1.6).

Fiz a auditoria só por leitura: nada rodado, nada alterado e sem commit. As respostas dos modelos não entram como fonte em nenhum ponto.

Fontes:

- docs/evaluation/01-evaluation-scenarios.md v1.6 (cenários);
- README, cujas seções de requisitos (§2) resumem o PRD;
- 01-domain-model.md v2.13 (DM) e 03-agent-flow.md v1.5 (AF);
- src/prompt.ts (prompt da V1);
- as justificativas de cada caso no próprio cases.json.

Como usei os rótulos:

- [PRD]: só para o que o README marca como requisito ou Anexo A (README §2).
- [Cenário]: o que vem do documento de cenários, inclusive o "Esperado (README §10)" que ele cita.
- [Premissa]: decisões do projeto ou do spike.
- PENDENTE: o que nenhuma fonte define.

## C1 — SC-01, "Horário do service desk"

**Origem.** SC-01: "Esperado (README §10): responde pelo artigo." README §2, história 1: "Tirar uma dúvida sem abrir chamado" [PRD].

**Entrada.** O SC-01 não traz texto literal ("1 turno: pergunta o horário do service desk"). O caso usa uma frase redigida: "Qual é o horário de atendimento do service desk?".

**O que a especificação exige:**

| Item            | Exigência                                                                                | Fonte                                 |
| --------------- | ---------------------------------------------------------------------------------------- | ------------------------------------- |
| Intenção        | ANSWER_KB                                                                                | [Cenário] SC-01, Interpretação        |
| Entidades       | nenhuma exigida; a entrada não traz problema, categoria, sistema operacional nem impacto | [Cenário] (SC-01 não lista entidades) |
| missingFields   | não declarado; outcome: ANSWER não tem coleta                                            | [Cenário], implícito                  |
| Tool e condição | searchArticles; evidência ART-HORARIO; não chamar propose\* nem requestHandoff           | [Cenário] SC-01, Política e Execução  |

O gabarito concorda. As palavras aceitas na query são as keywords de ART-HORARIO [Premissa], escolhidas para que toda query aceita encontre o artigo.

O prompt diz: "Para dúvidas, busque na central de ajuda e responda só com o que os artigos encontrados dizem. Se nenhum artigo se aplica, diga isso, sem inventar." (L22). A regra é inequívoca quanto a buscar, mas não nomeia a tool; a ligação com searchArticles vem da descrição da tool.

**Classificação:** sem divergência.

## C2 — SC-02, "VPN erro 809 no Windows 10"

**Origem.** SC-02: "Esperado (README §10): instrução do artigo." DM §3.11 (applicability por sistema operacional).

**Entrada.** O SC-02 não traz texto literal ("relata erro 809 de VPN e informa que usa Windows 10"). O caso usa uma frase redigida: "Minha VPN está dando erro 809. Uso Windows 10.".

**O que a especificação exige:**

| Item                                         | Exigência                                                                                                                                           | Fonte                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Intenção                                     | ANSWER_KB                                                                                                                                           | [Cenário] SC-02                |
| Entidades                                    | operatingSystem = Windows 10 (exigida); problem (erro 809 de VPN) extraível; category NETWORK_VPN só por mapeamento de "VPN" para "Rede e VPN"      | [Cenário] SC-02; [PRD] Anexo A |
| missingFields                                | não declarado; outcome: ANSWER                                                                                                                      | [Cenário], implícito           |
| Tool e condição                              | searchArticles; o filtro de applicability passa; sem propose\* nem requestHandoff                                                                   | [Cenário] SC-02; [DM] §3.11    |
| Regra geral (relato de falha: KB ou chamado) | PENDENTE (Bloco 4): no SC-03, a mesma entrada com Windows 11 tem a intenção marcada "as fontes não dizem se o turno 1 é ANSWER_KB ou CREATE_TICKET" | [Cenário] SC-03; AF §10        |

O gabarito concorda com o SC-02. O próprio cases.json registra que escolheu o SC-02 em vez do SC-03 por causa dessa pendência.

O prompt:

- Diz "ANSWER_KB: dúvida que a central de ajuda responde", "CREATE_TICKET: abrir um chamado novo" e "Tipos de chamado: INC (algo parou ou não funciona)" (L27).
- A entrada é um relato de falha, não uma pergunta. O prompt não diz que um relato de falha com artigo aplicável é ANSWER_KB, nem liga a escolha da intenção ao resultado da busca. Não é inequívoco.
- Sobre o sistema operacional ele é claro: "operatingSystem: o sistema operacional citado" (L46).

**Classificação:**

- O prompt não ensina a regra da intenção.
- A regra geral é uma especificação ambígua (PENDENTE de produto, SC-03). Para o SC-02 em si, o cenário fixa ANSWER_KB.

## C3 — SC-04, "Qual o status do meu chamado?"

**Origem.** SC-04: "Esperado (README §10): lista só os chamados do funcionário." README §2, história 2: "Saber como está um chamado meu, mesmo sem lembrar o número" [PRD]. AF §9.1, passo 1. DM §3.12: definições de LIST_MY_TICKETS e VIEW_TICKET.

**Entrada.** É a frase literal do SC-04: "Qual o status do meu chamado?".

**O que a especificação exige:**

| Item            | Exigência                                                                       | Fonte                                                |
| --------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Intenção        | LIST_MY_TICKETS (sem id informado; VIEW_TICKET só depois da escolha no seletor) | [Cenário] SC-04; [AF] §9.1, passos 1 e 3; [DM] §3.12 |
| Entidades       | nenhuma                                                                         | [Cenário]                                            |
| missingFields   | não declarado; outcome: ANSWER                                                  | [Cenário], implícito                                 |
| Tool e condição | listMyTickets, sem parâmetro de identidade                                      | [Cenário] SC-04 e §3 (ADR-004)                       |

O gabarito concorda.

O prompt diz "LIST_MY_TICKETS: ver a lista dos próprios chamados." (L33) e "VIEW_TICKET: consultar um chamado específico." (L34). A entrada fala de "meu chamado", no singular, sem id. O prompt não traz a regra do AF §9.1 ("sem número → listar"). Uma leitura literal do prompt admite VIEW_TICKET. Não é inequívoco.

**Classificação:** o prompt não ensina a regra (AF §9.1).

## C4 — SC-08, caso A, último turno ("Só para mim.")

**Origem.**

- SC-08: "Esperado (README §10): REQ, prioridade baixa."
- README §2, Anexo A: "Abertura: título, descrição, tipo, categoria, prioridade e afetados. Rascunho → confirmação → criação" e "REQ (pedido de acesso, equipamento, software)" [PRD].
- README §2, analista, história 1: "Receber chamados com tipo, categoria e prioridade corretos e descrição que dispense perguntar de novo" [PRD].
- DM §3.3 (CreateTicketDraft), DM §4 (regra 8), DM §5.1 ("Solicitar mouse → REQ, NONE") e AF §8.1, passos 2 a 5.

**Entrada.**

- O SC-08 descreve: turno 1 "pede um segundo monitor"; nos seguintes, "respostas por campo (alcance: só eu; impacto no trabalho: nenhum; risco de compromisso: não)".
- O caso grava "Preciso de um segundo monitor.", "Não afeta o meu trabalho.", "Não." e avalia "Só para mim.".
- As perguntas do assistente e a ordem delas são sintéticas [Premissa do spike]; a ordem das perguntas é PENDENTE no AF (P-D).

**O que a especificação exige:**

| Item                              | Exigência                                                                                                                                                                                                                                                                                                                                                                                | Fonte                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Intenção                          | CREATE_TICKET                                                                                                                                                                                                                                                                                                                                                                            | [Cenário] SC-08; [AF] §8.1                                           |
| Entidades deste turno             | impact.affectedScope = SELF (dito)                                                                                                                                                                                                                                                                                                                                                       | [Cenário] ("alcance: só eu")                                         |
| Entidades do histórico            | workImpact NONE e commitmentRisk NO (ditos); problem "segundo monitor". category não foi dita (inferir Hardware de "monitor" é suposição)                                                                                                                                                                                                                                                | [Cenário]                                                            |
| Entidades por turno ou acumuladas | PENDENTE: o DM §3.12 não define; o AF §2 diz que o backend preenche o collectedData "a partir das entidades do DecisionRecord"                                                                                                                                                                                                                                                           | [DM] §3.12; [AF] §2                                                  |
| missingFields                     | vazio se título, descrição, tipo e categoria vêm sem pergunta. O SC-08 só lista respostas de impacto, o que implica que não são perguntados. Mas o catálogo inclui TITLE, DESCRIPTION, TYPE e CATEGORY (DM §3.15), e o AF §8.1, passo 2, diz só que o collectedData "evolui (título, descrição, tipo, categoria, impactAssessment)". Quem infere ou redige esses quatro campos: PENDENTE | [Cenário], implícito; [DM] §3.15; [AF] §8.1                          |
| Tool e condição                   | proposeTicketDraft com o rascunho completo; o backend valida a completude (D3)                                                                                                                                                                                                                                                                                                           | [Cenário] SC-08; [AF] §8.1, passos 3 a 5, e D3                       |
| Argumentos                        | type REQ; impacto SELF, NONE e NO; sem prioridade e sem prazo                                                                                                                                                                                                                                                                                                                            | [Cenário] ("tipo REQ no rascunho"); [PRD] Anexo A; [DM] invariante 3 |
| Categoria                         | não especificada pelo SC-08                                                                                                                                                                                                                                                                                                                                                              | —                                                                    |

**Onde o gabarito diverge:**

- Concorda na intenção, no SELF obrigatório (com os demais campos opcionais), na tool, no REQ e na ausência de prioridade.
- category: HARDWARE obrigatória nos argumentos vai além da especificação. O próprio cases.json a marca como "[Inferência do spike], aprovada pelo autor em 2026-11-10".
- Os termos aceitos em title e description são [Premissa].
- missingFields exato [] adota a leitura de inferência, que a especificação só implica.

**O prompt:**

- Diz "Para abrir um chamado, colete primeiro o que falta. Só chame proposeTicketDraft quando título, descrição, tipo, categoria e a avaliação de impacto estiverem completos." (L23).
- Também diz "entities: preencha só o que o funcionário disse; nunca presuma um valor." (L43) e "missingFields: os dados que ainda faltam para a ação" (L50).
- Não diz que o assistente redige título e descrição nem que deduz tipo e categoria do pedido. "Colete o que falta" junto com "nunca presuma" admite a leitura de perguntar esses campos.
- Também não fica claro se o "nunca presuma" vale para os argumentos da tool. Não é inequívoco.

**Classificação:**

- Título, descrição, tipo e categoria, inferidos ou perguntados: especificação ambígua (PENDENTE de produto), e o prompt não ensina a regra.
- category HARDWARE obrigatória: gabarito diverge da especificação (acrescenta uma exigência que ela não faz).

## C5 — SC-13, "Pede analista com rascunho aberto"

**Origem.**

- SC-13: "Esperado (README §10): handoff; rascunho CANCELLED; resumo no evento."
- Anexo A: "Transferência: quando o funcionário pede…" [PRD].
- README §6: requestHandoff "só emite a intenção".
- DM §7.1, invariante 8 (o handoff cancela a ação pendente), e fixture CONV-DRAFT-OPEN ("Montada por turnos de roteiro").

**Entrada.**

- O SC-13 não traz texto literal ("pede para falar com um analista"). O caso usa uma frase redigida: "Quero falar com um atendente humano, por favor.".
- O rascunho aberto é a conversa do C4, mais o resultado gravado da proposeTicketDraft [Premissa do spike].

**O que a especificação exige:**

| Item            | Exigência                                 | Fonte                          |
| --------------- | ----------------------------------------- | ------------------------------ |
| Intenção        | HANDOFF                                   | [Cenário] SC-13                |
| Entidades       | nenhuma nova                              | [Cenário]                      |
| missingFields   | não declarado; outcome: HANDOFF           | [Cenário], implícito           |
| Tool e condição | requestHandoff, quando o funcionário pede | [Cenário] SC-13; [PRD] Anexo A |

Os efeitos de backend (conversa em WAITING_ANALYST, ação cancelada, resumo) ficam fora do spike, que declara isso no próprio caso.

O gabarito concorda.

O prompt diz "Se o funcionário pedir para falar com uma pessoa, chame requestHandoff." (L24) e "HANDOFF: falar com um analista humano." (L38). Inequívoco.

**Classificação:** sem divergência.

## C6 — SC-10, "Parou tudo" sem dizer quem é afetado

**Origem.**

- SC-10: "Esperado (README §10): pergunta o alcance (AFFECTED_SCOPE_MISSING)".
- DM §4, regra 1 (BLOCKED sem alcance devolve NEEDS_CLARIFICATION com AFFECTED_SCOPE_MISSING).
- DM §5.1 ("Notebook parou → INC, BLOCKED"; campo ausente = ainda não coletado).
- AF §8.1, passos 1 e 2.
- Tensão aberta X1 (Cenários §7.1).

**Entrada.** É a frase literal: "Parou tudo!".

**O que a especificação exige:**

| Item           | Exigência                                                                                                                                                                       | Fonte                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Intenção       | CREATE_TICKET. CLARIFY existe só no catálogo do DM §3.12, sem semântica em nenhum documento                                                                                     | [Cenário] SC-10; [AF] §8.1, passo 1; [DM] §3.12 |
| workImpact     | BLOCKED: a Política do cenário fixa o rascunho com esse valor                                                                                                                   | [Cenário] SC-10; [DM] §5.1 como apoio           |
| affectedScope  | ausente ("sem informar o alcance")                                                                                                                                              | [Cenário]; [DM] §5.1                            |
| commitmentRisk | dispensado com BLOCKED                                                                                                                                                          | [DM] §4                                         |
| missingFields  | inclui AFFECTED_SCOPE; a pergunta nasce do missingFields (X1)                                                                                                                   | [Cenário] SC-10 e §7.1                          |
| Tools          | "nenhuma tool de escrita"; não devem existir PendingAction, OperationExecution nem chamado novo. Logo, proposeTicketDraft é proibida. Tools de leitura: a especificação não diz | [Cenário] SC-10, Execução                       |

**Onde o gabarito diverge:**

- Concorda na intenção, no BLOCKED obrigatório, no escopo ausente, no AFFECTED_SCOPE incluído e em WORK_IMPACT e COMMITMENT_RISK proibidos.
- expectedTool: none também proíbe as tools de leitura (searchArticles, listMyTickets). O SC-10 proíbe só escrita e PendingAction. O cases.json marca isso como "[Inferência]".
- O critério C6 do CRITERIA da V1 ("nenhuma chamada de tool de negócio") herda essa inferência.

**O prompt:**

- "CLARIFY: não é possível saber o que o funcionário quer." (L41). A descrição é uma premissa do spike, como o próprio comentário do prompt.ts registra ("[Premissa do spike] A descrição de CLARIFY: o DM só lista o valor no catálogo, sem semântica"). O prompt não diz que um relato de problema sem detalhes é CREATE_TICKET com campos a coletar (AF §8.1).
- "BLOCKED (parado, não consegue trabalhar)" (L48) e "nunca presuma um valor" (L43): se "Parou tudo!" conta como dizer BLOCKED fica ambíguo, porque "não consegue trabalhar" não foi dito.
- "Com workImpact BLOCKED, não se pergunta sobre compromisso." (L49) é claro.
- L23 é claro sobre não propor com o rascunho incompleto.
- O prompt não fala de tools de leitura nesse caso.

**Classificação:**

- Intenção CREATE_TICKET em vez de CLARIFY: o prompt não ensina a regra. A especificação a fixa no cenário, mas não define CLARIFY.
- BLOCKED a partir de "Parou tudo!": o prompt não ensina de forma inequívoca. A especificação a fixa no SC-10.
- Proibição das tools de leitura: gabarito diverge da especificação (mais restritivo que o SC-10).
- X1: tensão aberta da especificação sobre onde aparece o AFFECTED_SCOPE_MISSING. Não muda o gabarito da interpretação.

## Resumo das classificações

| Caso | Ponto                                                                                  | Classificação                                                                       |
| ---- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| C1   | —                                                                                      | sem divergência                                                                     |
| C2   | Intenção de um relato de falha com artigo aplicável                                    | prompt não ensina a regra; regra geral PENDENTE de produto (SC-03, Bloco 4)         |
| C3   | "Meu chamado" sem número → listar                                                      | prompt não ensina a regra (AF §9.1)                                                 |
| C4   | Título, descrição, tipo e categoria inferidos ou perguntados (e o missingFields vazio) | especificação ambígua (PENDENTE de produto); prompt não ensina a regra              |
| C4   | category HARDWARE obrigatória nos argumentos                                           | gabarito diverge da especificação (exigência não especificada)                      |
| C4   | Entidades por turno ou acumuladas                                                      | especificação não define (PENDENTE); o gabarito trata como opcionais, sem penalizar |
| C5   | —                                                                                      | sem divergência                                                                     |
| C6   | CREATE_TICKET × CLARIFY                                                                | prompt não ensina a regra; CLARIFY sem semântica na especificação                   |
| C6   | BLOCKED a partir de "Parou tudo!"                                                      | prompt não ensina de forma inequívoca (L48 × L43); a especificação fixa no SC-10    |
| C6   | Tools de leitura proibidas                                                             | gabarito diverge da especificação (mais restritivo)                                 |
