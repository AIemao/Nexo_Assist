# ADR-001 — Agent híbrido: LLM interpreta, código decide e executa

- **Status:** Aceito
- **Data:** 2026-11-02
- **Bloco:** 1

Este ADR responde às três perguntas de README §11: por que assim, quais alternativas e o que mudaria com 20 mil funcionários. Registra a decisão, a motivação e as consequências. As especificações ficam no README, no Domain Model (DM) e no Agent Flow (AF), citados na Rastreabilidade.

## Contexto

O Nexo Assist é um agent de service desk. Ele conversa com funcionários, consulta artigos e chamados, e propõe operações em um ticket-service separado, que representa um sistema legado e potencialmente instável.

O PRD exige, entre outros pontos, que nenhum chamado seja escrito sem confirmação do funcionário, que chamados de terceiros nunca sejam expostos e que as ações sejam transparentes e auditáveis.

A questão central é: **quanto poder de interpretação e execução deve ser concedido ao LLM?**

## Decisão

**O LLM interpreta e propõe. O código decide e executa.**

**Leitura.** O agent usa tools de leitura, como `searchArticles` e `listMyTickets`. A autorização continua no backend. A identidade do funcionário vem da sessão e é injetada pelo backend; o LLM não a fornece (README §8).

**Escrita.** O LLM **não possui nenhuma tool que escreva no ticket-service**. Ele pode chamar tools de proposta, como `proposeTicketDraft` e `proposeTicketUpdate`. Elas resultam em uma `PendingAction`, que é a autorização pendente e não uma escrita executada. A execução cabe ao backend, depois que o funcionário confirma na UI. A confirmação vale para o ID e a versão atuais da proposta. `requestHandoff` só expressa a intenção de transferir; o backend aplica a política e controla a operação.

**Um turno, três etapas distintas.** Interpretação, política e execução não se misturam. O `DecisionRecord` registra a interpretação e a decisão de política. O backend registra as execuções reais e o modelo não declara sucesso de nada. Proposta, autorização (`PendingAction`) e execução (`OperationExecution`) são registros separados, e a auditoria distingue o que foi proposto, o que foi autorizado e o que foi executado. O mesmo princípio vale para o estado da conversa: o backend altera o `InteractionContext` e o LLM não o escreve (AF D1).

**Pior caso.** Se o LLM ignorar o prompt ou for manipulado, por exemplo por prompt injection em uma mensagem ou em um artigo, o modelo não tem caminho de escrita no ticket-service. As tools de proposta gravam uma `PendingAction` no banco do web, e não existe escrita no ticket-service. O máximo que o modelo consegue é criar uma proposta indesejada ou incorreta. Essa proposta é validada pelo backend, fica visível ao funcionário e é limitada a uma pendente por conversa (DM §7.1, invariante 7). Ela não executa sem confirmação na UI (DM §7.1, invariante 5).
Nas leituras, o mesmo vale: o modelo não consegue consultar chamados de terceiros, porque as tools não recebem `userId` (a identidade vem da sessão) e o ticket-service valida o solicitante em toda leitura (README §8).

## Alternativas consideradas

### A. Agent autônomo com tools de escrita

O LLM chama diretamente tools que executam operações no ticket-service. Foi descartada por três motivos:

- A escrita não passa pela confirmação estrutural que o PRD exige.
- Parâmetros mal interpretados ou alucinados chegam direto ao sistema legado.
- A fronteira de autorização passa a depender do comportamento do modelo.

### B. Tools de escrita com confirmação instruída pelo prompt

O LLM tem tools de escrita e o prompt manda pedir confirmação antes de usá-las. É a alternativa concorrente mais forte: simples, com menos entidades, e funciona bem no caso comum. Não foi escolhida porque o que ela oferece é conformidade, e o PRD pede garantia:

- A confirmação depende de o modelo obedecer em todas as situações, inclusive diante de entrada manipulada. Não é uma barreira estrutural de execução.
- "Escrita sem autorização é impossível" não é verificável por teste determinístico se a escrita está ao alcance do modelo. Só é possível testar quanto o modelo obedece, e isso é uma taxa.
- Não há vínculo estruturado entre a identidade do funcionário, a proposta que ele viu, o ID e a versão autorizados e a operação executada.
- Auditar por mensagens e histórico de conversa é inferior a um registro explícito do ciclo de autorização e execução.

**Instruções ao modelo orientam comportamento; controles no backend restringem capacidade.** O prompt continua útil para orientar o modelo, mas não é a fronteira de segurança.

### C. Fluxo determinístico, com o LLM apenas como classificador de intenção

O fluxo inteiro é uma árvore de decisão e o LLM só classifica o que o funcionário quer. Isso dá previsibilidade, mas torna a interação rígida. Reduz a capacidade de conduzir uma conversa para esclarecer o problema. Também não aproveita o LLM para formular respostas fundamentadas em artigos, exigência do PRD. Fluxos determinísticos não são inadequados em geral. O que se rejeita é usá-los como arquitetura exclusiva do agent. A decisão adotada mantém o determinismo onde ele importa (política, autorização, execução, estado).

## Consequências

**Positivas**

- "Escrita sem confirmação = zero" passa a ser uma propriedade estrutural e testável, não uma expectativa sobre o modelo (README §10).
- Trocar o provedor ou o modelo (ADR-009) não altera a fronteira de segurança: o LLM continua sem tool de escrita no ticket-service.
- Autorização, proposta e execução têm registros distintos e rastreáveis.
- Falhas, retentativas e resultados desconhecidos são tratados pelo backend, sem delegar ao modelo a tarefa de dizer o que aconteceu.

**Negativas e custos**

- Mais entidades e estados para administrar (`PendingAction`, `OperationExecution`, `DecisionRecord`).
- Um passo de confirmação a mais para o funcionário.
- Versionamento de propostas e tratamento de confirmações obsoletas.
- O agent não corrige um chamado por iniciativa própria; precisa respeitar a política de autorização.
- Maior complexidade de implementação e de testes.

## E se o produto crescer para 20 mil funcionários?

A decisão continua válida e fica mais importante com a escala, porque o custo de um erro do modelo cresce com o volume. Evoluem o volume de consultas, propostas e execuções, o processamento assíncrono e, possivelmente, a política de confirmação conforme o tipo e o risco da operação. Um exemplo é um comentário de baixo risco ser autorizado por uma política explícita, sem clique individual, enquanto as operações mais relevantes continuam exigindo confirmação.

**Ressalva:** isso é uma evolução futura, não uma capacidade do contrato atual. A invariante 5 do DM v2.2 exige confirmação antes da escrita. Uma pré-autorização precisaria ser definida formalmente no modelo de autorização, com escopo e auditoria explícitos, e não está implementada nem aprovada. O argumento arquitetural é que a política pode evoluir sem abandonar a separação entre interpretação, decisão e execução.

## Rastreabilidade

- README §6 (estratégia híbrida e três camadas), §8 (proteções), §10 (métricas) e §11 (ADRs).
- Domain Model v2.2: §1, §§3.12–3.15 e §7.1 (invariantes 5 e 7).
- Agent Flow v1.2: D1, D3 e D4.
