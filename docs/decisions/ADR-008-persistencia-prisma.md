# ADR-008 — Persistência do ticket-service com Prisma ORM e SQLite

- **Status:** Aceito
- **Data:** 2026-11-05
- **Bloco:** 3

Com que ORM e driver o ticket-service persiste seus dados no SQLite, e sob quais condições?

## Contexto

O ticket-service precisa persistir chamados, eventos, logs de acesso e chaves de idempotência (README §9), e esses dados sobrevivem a reinício (README §2). O SQLite já estava decidido; o ORM e o driver ficaram para o Bloco 3 (README §12 #6; DM §10).

A persistência fica atrás de uma camada de repositório, e o domínio não conhece o banco (README §5).

Duas regras precisam ser demonstráveis na persistência:

- **Idempotência:** chave única e devolução do resultado original quando a mesma operação é repetida (README §9; ADR-005).
- **Concorrência otimista:** atualização condicionada à versão esperada, verificando a quantidade de linhas afetadas (README §9).

## Decisão

**Runtime.** Node 26 LTS, já adotado como versão-base do projeto (README §5). É uma decisão separada da escolha do driver SQLite e não é reaberta aqui.

**Persistência.** Prisma ORM **7.10.1** com SQLite, usando o adapter `@prisma/adapter-better-sqlite3`.

**Condições obrigatórias.** A decisão vale com estas cinco condições, que a primeira branch de implementação deve cumprir. Nenhuma delas está aplicada na `main` na data deste ADR.

1. **Versões fixas.** `prisma`, `@prisma/client` e `@prisma/adapter-better-sqlite3` em `7.10.1`, sem `^`. Na data do spike (2026-11-05), a tag `latest` do npm apontava para o Prisma `8.0.0-rc.30`, uma Release Candidate. Fixar a versão evita a atualização acidental para uma versão não estável.
2. **Política `allowScripts`.** Aprovar explicitamente apenas `@prisma/engines`, `better-sqlite3` e `prisma`. No npm 11.20.0, a saída observada indicou o comando `npm install-scripts approve <pkg>`. Hoje o npm emite avisos para scripts não cobertos pela política; versões futuras podem bloqueá-los. O local adequado da política no monorepo será validado na primeira branch de implementação.
3. **Migrações nos testes.** Aplicar as migrações uma única vez por execução da suíte, com `globalSetup` do Vitest, e não em cada teste. A condição decorre do custo observado de inicialização do CLI do Prisma no Windows (ver Evidências).
4. **Isolamento do domínio.** O Prisma aparece somente na camada de persistência e nos repositórios. Nenhum import de Prisma em `src/domain`; o domínio continua sem dependências de infraestrutura.
5. **Cliente gerado.** O cliente gerado não é versionado no Git. É gerado automaticamente pelo `postinstall` (`prisma generate`). A regra do `.gitignore` correspondente entra no mesmo commit que instala o Prisma.

## Alternativas consideradas

### A. `node:sqlite` nativo com SQL explícito

É a alternativa concorrente mais forte. Tem zero dependências externas para o driver, não usa módulo nativo e deixa visível o SQL da idempotência e da concorrência otimista. Foi rejeitada porque:

- No Node 26.13, a API está em Stability 1.2 (Release candidate), não Stable.
- Exige mapeamento manual entre linhas do banco e tipos do domínio.
- Exige migrações manuais.
- Não oferece vantagem suficiente diante da experiência prévia do autor com Prisma.

### B. `better-sqlite3` com SQL explícito

Driver maduro e síncrono, com controle direto do SQL. Foi rejeitada porque mantém o custo de mapeamento e de migrações manuais e traz o módulo nativo sem os benefícios de tipos gerados e gerenciamento de migrações do Prisma.

### C. Drizzle, sobre `node:sqlite` ou `better-sqlite3`

Tem schema tipado, inferência de tipos, ferramentas de migração e uma camada mais leve que um ORM completo. Foi rejeitada porque não apresentou vantagem concreta sobre o Prisma que justificasse uma terceira alternativa, o autor não tem experiência prévia com Drizzle e o Prisma já passou pelo spike nas duas plataformas.

## Evidências do spike

O spike rodou na branch `spike/prisma`, depois descartada. O Draft PR foi fechado sem merge, e os commits do spike não integram a `main`. Os números abaixo são os observados; o rótulo **Inferência** marca o que não foi observado diretamente.

| Evidência | Windows | Linux (CI) |
| --- | --- | --- |
| Ambiente | Node 26.13.0, npm 11.20.0 | Node 26.13.0 |
| `npm ci` | 215 pacotes adicionados, aproximadamente 2 minutos | 217 pacotes adicionados, 8 segundos |
| Baseline sem Prisma | — | 40 pacotes adicionados, aproximadamente 1 segundo |
| `better-sqlite3` | 12.11.1; binário pré-compilado, sem arquivos de compilação em `build/Release` | **Inferência:** provável binário pré-compilado, sustentada pelos 8 segundos de instalação e pelos testes verdes. A saída dos scripts não foi exibida, portanto não houve confirmação direta. |
| `EBADENGINE` | Nenhum | Nenhum |
| Avisos | `prebuild-install@7.1.3` depreciado e três avisos `install-scripts` | Os mesmos três avisos `install-scripts` |
| Cliente gerado | Recriado pelo `postinstall`, confirmado apagando a pasta e executando `npm ci` | **Inferência:** o typecheck e os testes verdes dependem do cliente gerado, mas a linha de execução do `postinstall` não apareceu diretamente no log. |
| TypeScript 7 | Typecheck aprovado | Typecheck aprovado |
| Testes | 7 arquivos, 80 testes, 14,4 s | 7 arquivos, 80 testes, 1,56 s |
| Teste do spike | 12,3 s | 0,98 s |

**Avisos e versão.** Os três avisos `install-scripts` (`@prisma/engines`, `better-sqlite3` e `prisma`) apareceram no npm 11.20.0, e a saída exibiu `npm install-scripts approve <pkg>`. Em 2026-11-05, a tag `latest` do npm apontava para o Prisma `8.0.0-rc.30`. Os dois pontos são riscos controláveis pelas condições 1 e 2, não riscos ausentes.

**TypeScript 7 e código gerado.** O cliente gerado tem nove arquivos incluídos no typecheck, sem erros nem avisos de compatibilidade. Ressalva: o Prisma gera os arquivos com `// @ts-nocheck`. Os tipos usados pelo código da aplicação são verificados, mas o corpo dos arquivos gerados não passa pela verificação interna do TypeScript.

**Concorrência otimista.** O teste do spike demonstrou que a atualização com a versão esperada devolve `count === 1` e que a repetição com a versão antiga devolve `count === 0`.

**Custo de execução dos testes.** O teste de migração do spike levou 12,3 s no Windows, quase todo consumido pela inicialização do CLI do Prisma, e 0,98 s no Linux. Essa diferença fundamenta a condição 3 (migrações uma vez por execução da suíte, via `globalSetup`).

**Dependências.**
- `dependencies`: `@prisma/client` e `@prisma/adapter-better-sqlite3`, ambos 7.10.1.
- `devDependencies`: `prisma`, 7.10.1.
- `better-sqlite3` 12.11.1 é dependência transitiva do adapter.

## Consequências

**Positivas**
- Tipos gerados a partir do schema.
- Migrações versionadas.
- Experiência prévia do autor, importante porque o código será discutido e alterado ao vivo na entrevista.
- Caminho mais curto para a evolução ao PostgreSQL.
- Instalação e execução validadas em Windows e Linux.

**Negativas e custos**
- Crescimento de 40 para 217 pacotes adicionados no CI (métrica `added` do `npm ci`); no Windows, 215 com Prisma.
- Módulo nativo, com risco controlado pelas condições de versão e de scripts.
- Versão fixada contra a tag `latest`.
- Cliente gerado com `@ts-nocheck`.
- Maior custo de inicialização do teste de migração no Windows.

## E se o produto crescer para 20 mil funcionários?

O número de funcionários não exige PostgreSQL por si só. O SQLite permite múltiplos leitores, mas tem um único escritor por arquivo de banco. O PostgreSQL passa a ser necessário quando a concorrência de escrita, o uso de múltiplas instâncias do serviço ou os requisitos de operação excederem o que o SQLite atende adequadamente.

**Permanece:** a persistência atrás de repositórios, com o domínio sem dependências de infraestrutura.

**Pode evoluir** (hipótese futura, não decidida por este ADR): PostgreSQL, que o README §5 já prevê como evolução de deploy. O Prisma preserva os models e boa parte dos repositórios, mas a troca não é automática: exige novo histórico de migrações, revisão de SQL específico e migração dos dados.

## Rastreabilidade

- README §2 (persistência sobrevive a reinício), §5 (stack; persistência atrás de repositório; PostgreSQL no deploy), §9 (idempotência e concorrência) e §12 #6 (ORM e driver do SQLite).
- Domain Model v2.7: §10 (pendência anterior de ORM e driver, agora remetida a este ADR).
- ADR-002 (o ticket-service como aplicação separada, dona do domínio dos chamados).
- ADR-005 (idempotência por `OperationExecution.id`).
