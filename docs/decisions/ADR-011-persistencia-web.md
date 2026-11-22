# ADR-011 — Persistência do web com Prisma ORM e SQLite, separada do ticket-service

- **Status:** Aceito em 2026-11-21
- **Data:** 2026-11-21
- **Bloco:** 4 (parte web das fatias 1 e 2)

Com que ORM e banco o web persiste o estado conversacional, e onde fica a fronteira com o Mastra?

## Contexto

- **As entidades de estado conversacional ficam no web.** `Conversation`, `ConversationEvent`, `Message`, `PendingAction`, `OperationExecution`, `DecisionRecord`, `ConversationTicket` e `ConversationTicketInteraction` têm o web como dono (DM §1 e §2). A coluna "Dono" é contexto arquitetural: nenhuma regra de negócio depende de onde a entidade mora (DM, `01-domain-model.md`:35).
- **Há operações que precisam ser atômicas no web.** A `PendingAction` é cancelada na mesma transação local que encerra a conversa ou a transfere ao analista (DM, `01-domain-model.md`:572, :894, :904, :965 e :1110).
- **O README já põe um SQLite de conversas dentro do web**, separado do SQLite de chamados e funcionários do ticket-service (README §5, diagrama da visão geral).
- **O ADR-008 é só do ticket-service.** O título e a pergunta tratam de "como o ticket-service persiste seus dados" (ADR-008, linhas 1 e 7); nenhum documento estendia a decisão ao web.
- **Os artigos da central de ajuda ficam em JSON**, num módulo de conhecimento do web (ADR-003; DM §3.11).

## Decisão

**Persistência.** Prisma ORM **7.10.1** + `@prisma/adapter-better-sqlite3` **7.10.1** + `better-sqlite3` **12.11.1** + SQLite, as mesmas versões do ticket-service (ADR-008, condição 1).

- O web tem **banco, schema, migrações, cliente gerado, Unit of Work e repositórios próprios**.
- **Nenhum compartilhamento com o banco do ticket-service:** nem arquivo SQLite, nem schema, nem cliente gerado. O web só conversa com o ticket-service pela API HTTP (ADR-002; `04-http-contract.md`).
- As operações sobre `Conversation` e `PendingAction` que o DM exige atômicas (cancelamento no handoff e no encerramento) ficam **atômicas na Unit of Work do web**.

**Fronteira do Mastra.**

- O web persiste e controla `Conversation`, `Message` e as demais entidades de estado conversacional. O Mastra recebe o contexto para executar o agent, mas **não é dono do histórico**.
- **Proibido** usar o storage do Mastra como armazenamento durável concorrente de conversa, mensagens ou memória conversacional.
- **Memória do Mastra desligada é a preferência.** Estado transitório em memória do processo é aceito, desde que nunca seja tratado como registro.
- O transcript que o agent recebe é **reconstruído a partir das entidades do web**, inclusive o da fase 2 da integração D1 (ADR-009, decisão 2).

**Atualização (2026-11-22, transcript da fase 2).** Nota posterior à decisão; o texto acima não muda. Esclarecimento (decisão do autor, 2026-11-22): o histórico dos turnos anteriores é reconstruído a partir das entidades do web, no formato do `toMessages` da tag do spike (ADR-009, nota de 2026-11-22; DM v2.19 §3.12, `toolExecutions`). A fase 2 do turno atual usa a resposta da fase 1 em memória, filtrada (`filterTranscript`), sem passar pela persistência.

**Conhecimento.** `KnowledgeArticle` continua em JSON, fora do banco (ADR-003; DM §3.11).

## Lições do ADR-008 que valem para o web

| Lição | Origem |
| --- | --- |
| Todo acesso ao banco pelo fluxo da aplicação, inclusive leituras, passa pela Unit of Work: o adapter usa uma única conexão, e uma leitura pelo cliente raiz durante uma transação aberta enxerga dados não confirmados | ADR-008, "Conexão única do adapter better-sqlite3" (linhas 36 e 141-176) |
| Migrações aplicadas uma vez por execução da suíte, num `globalSetup` do Vitest, por causa do custo do CLI do Prisma no Windows | ADR-008, condição 3 (linha 30) |
| Scripts de instalação aprovados explicitamente em `allowScripts`, no `package.json` da raiz, com versão fixada | ADR-008, condição 2 (linha 29); `package.json`, `allowScripts` |
| Enums validados pelo Prisma Client, não pelo SQLite (viram `TEXT`); escrita fora do Prisma não tem essa proteção | README §5, Princípios ("Catálogos persistidos"); ADR-008, "Limitação aceita" (linha 139) |
| Validações entre campos fora do banco, antes da gravação, sem `CHECK` manual: a recriação de tabela do Prisma o descarta | ADR-008, linha 34 e "Experimento: CHECK manual no SQLite" (linhas 111-139) |
| Banco local descartável: sem backfill; uma migração que recria tabelas desliga a verificação das FKs e não tem `PRAGMA foreign_key_check`, então recriar o banco é pré-condição | ADR-008, notas de 2026-11-21 (linhas 42 e 47-60); README §5 |
| Prisma só na camada de persistência; cliente gerado fora do Git, recriado no `postinstall` | ADR-008, condições 4 e 5 (linhas 31-32) |

## Alternativas consideradas

### A. Outro ORM ou SQL explícito no web

`node:sqlite` ou `better-sqlite3` com SQL explícito, ou Drizzle. O ADR-008 já rejeitou as três para o ticket-service (alternativas A a C):

- `node:sqlite` com SQL explícito: API em Stability 1.2 (Release candidate) no Node 26.13, mapeamento e migrações manuais, sem vantagem suficiente diante da experiência prévia do autor com Prisma;
- `better-sqlite3` com SQL explícito: mantém o custo de mapeamento e de migrações manuais e traz o módulo nativo sem os tipos gerados e o gerenciamento de migrações do Prisma;
- Drizzle: sem vantagem concreta sobre o Prisma que justificasse uma terceira alternativa, sem experiência prévia do autor e sem o spike que o Prisma já passou nas duas plataformas.

Para o web, este ADR acrescenta um motivo próprio: uma segunda forma de persistência no repositório dobraria o que se aprende e se mantém, sem ganho concreto, enquanto as lições do ADR-008 valem de imediato.

### B. Banco compartilhado com o ticket-service

Um único arquivo SQLite para as duas aplicações. Rejeitado: apaga a fronteira de propriedade que justifica as duas aplicações (ADR-002), acopla migrações e schema dos dois lados e permitiria ao web ler chamados sem passar pelas regras do ticket-service (privacidade, README §8).

### C. O ticket-service guardar a conversa

Rejeitado: contraria o ADR-002, que separa a experiência de atendimento (UI, BFF, agent e conhecimento) do domínio dos chamados, e transformaria o ticket-service num serviço genérico de dados, o que o README §5 também evita para os artigos ("O ticket-service não vira um serviço genérico de dados", Princípios, linha 241).

### D. Storage do Mastra como registro da conversa

Usar a memória ou o storage do Mastra como fonte das mensagens e do estado. Rejeitado: o estado conversacional tem regras do domínio (ciclos de estado, `PendingAction` atômica com a conversa, `DecisionRecord` por turno; DM §3.5 a §3.14, §8) que precisam viver na Unit of Work do web; um segundo armazenamento durável competiria com ele como fonte da verdade.

## Fora do escopo

- **Mecanismo de sessão do login** (cookie, armazenamento da sessão, expiração). É um gate do plano de implementação do web. Este ADR não o decide.

**Atualização (2026-11-22).** Nota posterior à decisão; o texto acima não muda. O mecanismo de sessão, deixado fora do escopo como gate do plano do web, foi decidido no ADR-012 (aceito em 2026-11-21).

## Riscos a validar na implementação

- [Inferência] O `better-sqlite3` é módulo nativo. Nenhum documento confirma que ele carrega sem ajuste no servidor do Next.js 16 (empacotamento do servidor e runtime das rotas). A validação é instalar, compilar e rodar as rotas que acessam o banco.
- [Inferência] O Prisma 7 com cliente gerado num caminho do próprio app (como o `src/generated/prisma` do ticket-service) dentro do build do Next.js não está documentado neste repositório. A validação é o `next build` e os testes de integração.

**Atualização (2026-11-22, validação na F2 do plano do web).** Nota posterior à decisão; os riscos acima ficam registrados como estavam. Resultado da validação:

- O `better-sqlite3` 12.11.1 e o cliente Prisma 7.10.1 (`prisma-client`, gerado em `apps/web/src/generated/prisma`) funcionam no `next build` e no `next start` do Next.js 16.4.6 (Turbopack), **sem `serverExternalPackages`** e sem nenhuma outra configuração: o `next.config.ts` do web está vazio. Evidência: o smoke do web (`apps/web/scripts/smoke.ts`) faz o build, sobe o servidor com um banco temporário migrado e recebe 200 do `GET /api/health` com uma leitura real pelo Prisma; um teste de integração (Vitest) cria e lê `Session` pela Unit of Work.
- Validado no Windows (máquina do autor) e na CI (`ubuntu-latest`), no PR da F2.

## Consequências

**Positivas**
- As duas aplicações têm a mesma pilha de persistência, com as mesmas versões e as lições do ADR-008 aplicáveis desde o início.
- A fronteira entre web e ticket-service continua sendo só a API HTTP.
- O histórico da conversa tem uma única fonte da verdade, no web.

**Negativas e custos**
- Duas pilhas de migração e dois clientes gerados no repositório.
- O módulo nativo `better-sqlite3` entra também no app web (ver os riscos acima).
- Com a memória do Mastra desligada, o web monta o contexto do agent a cada turno.

## E se o produto crescer para 20 mil funcionários?

**Permanece:** a separação entre o banco do web e o do ticket-service, a persistência atrás de repositórios e o histórico da conversa no web, não no framework do agent.

**Pode evoluir** (hipótese futura, não decidida por este ADR): PostgreSQL também no web, já previsto na stack para o deploy (README §5). As ressalvas do ADR-008 sobre pool de conexões (linhas 173-176) valem igualmente aqui.

## Rastreabilidade

- README §5 (visão geral, princípios, stack), §8 (privacidade) e §12 #6.
- Domain Model v2.17: §1, §2, §3.5 a §3.14, §8.
- ADR-002 (duas aplicações), ADR-003 (artigos em JSON no web), ADR-008 (persistência do ticket-service e lições), ADR-009 (integração D1; versão do Mastra) e ADR-010 (versões exatas, regra geral desde 2026-11-21).
- `04-http-contract.md` (fronteira HTTP entre web e ticket-service).
