# ADR-013 — Estrutura do app web: App Router, Route Handlers como BFF e Mastra no mesmo processo

- **Status:** Aceito em 2026-11-21
- **Data:** 2026-11-21
- **Bloco:** 4 (parte web das fatias 1 e 2)

Como o app web se organiza no Next.js, onde roda o agent Mastra e o que o funcionário vê enquanto o turno é processado?

## Contexto

- **`apps/web` reúne UI, BFF, agent e conhecimento.** São duas aplicações executáveis: o web (Next.js) e o ticket-service (ADR-002; README §5).
- **O BFF são os Route Handlers.** O diagrama da visão geral põe "Route Handlers · Auth · Conversas · Estado" dentro do web (README §5).
- **O agent roda só no servidor.** Credenciais do provedor nunca chegam ao navegador (README §5, Princípios; ADR-002).
- **O LLM interpreta e propõe; o código decide e executa** (README §1; ADR-001). Pela integração D1, a interpretação sai de uma segunda chamada e só vale depois de validada pelo código (ADR-009, decisão 2 e condição 2).
- **O web usa Prisma e `better-sqlite3`** (ADR-011). Os riscos de empacotar o módulo nativo e o cliente gerado no servidor do Next.js estão registrados no ADR-011 ("Riscos a validar na implementação").
- As versões do Next.js, do React e do `@mastra/core` estão aprovadas (README §5, "Versões das dependências").

## Decisão

Decisão do autor (2026-11-21).

**Roteamento.** Next.js com **App Router**.

**BFF.** **Route Handlers**, como no diagrama do README §5.

**Agent.**

- O agent Mastra roda **no mesmo processo do Next.js**, num módulo só do servidor, chamado pelo Route Handler.
- **Sem servidor Mastra separado** (ADR-002: duas aplicações executáveis).

**Fronteira do servidor.** Módulos que importam Prisma, `better-sqlite3` ou Mastra **nunca** entram no grafo dos componentes do cliente.

**O que o funcionário vê durante o turno.**

- **Nenhum texto do modelo** chega ao funcionário antes da decisão do código (README §1; ADR-009, D1).
- **No Bloco 4**, a interface mostra só um indicador de processamento.
- **Um eventual streaming no Bloco 6** é só do conteúdo final já aprovado pela política, nunca dos tokens do modelo.

## Alternativas consideradas

### A. Pages Router

O roteador anterior do Next.js, com API Routes no lugar dos Route Handlers. Rejeitada: os Route Handlers do diagrama do README §5 pertencem ao App Router, e adotar o Pages Router mudaria a peça que a arquitetura já nomeia como BFF.

### B. Servidor Mastra separado

O agent num processo próprio, chamado pelo web pela rede. Rejeitada: cria uma terceira aplicação executável, contra o ADR-002 (duas aplicações executáveis).

### C. Streaming dos tokens do modelo

Mostrar o texto do modelo enquanto ele é gerado. Rejeitada: o texto chegaria ao funcionário antes de o código validar a interpretação e aplicar a política (ADR-009, D1 e condição 2), contra a tese de que o código decide (README §1; ADR-001). Uma resposta depois recusada pela política já teria sido lida.

## Consequências

**Positivas**
- O BFF fica na peça que a arquitetura já descreve (README §5).
- Duas aplicações executáveis, como no ADR-002; nenhum salto de rede entre o BFF e o agent.
- Prisma, `better-sqlite3`, Mastra e as credenciais do provedor ficam fora do navegador.
- O funcionário só vê o que a política aprovou.

**Negativas e custos**
- Com a latência medida no spike (mediana de cerca de 43 s por turno, ADR-009, condição 5), o funcionário espera o turno inteiro vendo só o indicador de processamento.
- O agent divide o processo com o servidor do Next.js: uma falha ou um travamento no agent atinge o mesmo processo que atende a UI e o BFF.
- O mecanismo que impede os módulos do servidor de entrar no grafo do cliente não é decidido aqui e fica para o plano do web.
- Os riscos de empacotamento do ADR-011 (`better-sqlite3` e cliente Prisma no build do Next.js) continuam a validar.

## E se o produto crescer para 20 mil funcionários?

**Permanece:** nenhum texto do modelo antes da decisão do código; módulos do servidor fora do cliente; o BFF como única porta do web para o ticket-service.

**Pode evoluir** (hipótese futura, não decidida por este ADR): o processamento do agent com workers e filas, já registrado como hipótese no ADR-002. Nesse caso o agent sairia do processo do Next.js, e esta decisão seria revista.

## Rastreabilidade

- README §1 (tese), §5 (visão geral, princípios, stack e versões) e §8 (credenciais fora do navegador).
- ADR-001 (estratégia híbrida), ADR-002 (duas aplicações; hipótese de workers e filas), ADR-009 (integração D1; condições 2 e 5; versão do Mastra) e ADR-011 (persistência do web; riscos de empacotamento).
