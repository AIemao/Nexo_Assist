# ADR-012 — Sessão do login simulado: token opaco em cookie, hash no banco do web

- **Status:** Aceito em 2026-11-21
- **Data:** 2026-11-21
- **Bloco:** 4 (parte web das fatias 1 e 2)

Como o web guarda, valida e encerra a sessão do funcionário depois do login simulado?

## Contexto

- **A identidade vem da sessão.** As tools não têm parâmetro de identidade; o backend injeta o funcionário autenticado, e identidade e papel nunca vêm do LLM (ADR-004; README §8).
- **O login é simulado.** Qualquer senha vale para funcionários do seed (README §3, Tela 1; README §8; DM §3.1). A autenticação fica no web (README §8; ADR-002).
- **O funcionário vem do ticket-service.** O BFF chama o `POST /employees/lookup` com ator `SYSTEM`, antes de existir sessão, e usa o `id` e o `role` da resposta para montar a sessão e, depois, os cabeçalhos `X-Actor-*` (`04-http-contract.md` §10 e §2.2).
- **O mecanismo de sessão estava em aberto.** O ADR-011 o deixou fora do escopo, como gate do plano do web ("Fora do escopo"); nenhum documento decidia cookie, armazenamento, expiração nem logout.
- **O web tem banco próprio** (ADR-011).

## Decisão

Decisão do autor (2026-11-21).

**Token e cookie.**

- Token opaco de **256 bits**, gerado com `crypto.randomBytes` (`node:crypto`).
- Cookie `httpOnly` e `SameSite=Lax`.
- `Secure` com HTTPS. Exceção controlada para o desenvolvimento local em HTTP.

**Armazenamento.**

- O banco do web (ADR-011) guarda o **hash SHA-256** do token, **nunca o token**.
- Registro `Session` com o funcionário, o papel e a expiração.

**Expiração e logout.**

- Expiração **absoluta de 8 horas** a partir da criação, **sem renovação deslizante**.
- O logout invalida a sessão no banco e expira o cookie.

**Papel.**

- O papel é um **retrato** do lookup do login (`04-http-contract.md` §10), válido até a sessão expirar ou ser revogada.
- Uma futura mudança de papel precisará invalidar as sessões do funcionário.

**Dependências.** Nenhuma biblioteca além do `node:crypto`.

**Atualização (2026-11-22).** Nota posterior à decisão; o texto acima não muda. Decisão do autor (2026-11-22), no plano do web:

- **Logout:** grava `revokedAt`, e a linha fica no banco. `revokedAt` invalida a sessão antes de `expiresAt`.
- **Nome:** `name` é guardado na `Session` como retrato do lookup do login, como o papel.
- **Analista no Bloco 4:** um funcionário com `role` `ANALYST` não recebe sessão. A resposta é "O acesso de analista ainda não está disponível." O login do analista continua no Bloco 7 ("Fora do escopo").
- **Senha:** obrigatória e não vazia, sem verificação contra segredo (login simulado).
- **Limpeza:** no login, as sessões expiradas há mais de 1 dia são apagadas. Sessões válidas nunca são apagadas. Isso responde à [Inferência] das "Negativas e custos".
- **`Secure`:** primeiro, testar o cookie `Secure` em `http://localhost`. A variável `SESSION_COOKIE_SECURE` só existe se o teste mostrar que é necessária, com padrão `true` e proibida como `false` em produção.

## Alternativas consideradas

### A. Cookie assinado, sem estado no servidor

A sessão viaja inteira no cookie, assinada, sem registro no banco. Rejeitada:

- não há revogação: o logout não invalida um cookie que já saiu, e a sessão vale até a expiração gravada nele;
- exige um formato criptográfico próprio (assinatura, campos, versão), que este projeto teria de desenhar e manter.

### B. Biblioteca de sessão

Uma biblioteca pronta para cookie e armazenamento. Rejeitada: acrescenta uma dependência sem necessidade. O que a decisão exige (token aleatório, hash, cookie com atributos fixos, expiração absoluta) cabe no `node:crypto` e no banco que o web já tem (ADR-011).

## Fora do escopo

- **Login do analista** e acesso ao console (Bloco 7; ADR-004).

## Consequências

**Positivas**
- O logout revoga de fato: a sessão deixa de valer no banco.
- O banco não guarda segredo utilizável: um vazamento da tabela não entrega tokens válidos.
- Nenhuma dependência nova.
- Identidade e papel ficam no servidor, coerentes com o ADR-004.

**Negativas e custos**
- Cada requisição autenticada consulta o banco do web para validar a sessão.
- O papel pode ficar desatualizado até a sessão expirar, enquanto não existir a invalidação por mudança de papel.
- Sem renovação deslizante, o funcionário entra de novo depois de 8 horas, mesmo em uso.
- [Inferência] Sessões expiradas permanecem no banco até alguma limpeza; nenhuma está decidida aqui.

## E se o produto crescer para 20 mil funcionários?

**Permanece:** token opaco, só o hash no servidor, expiração absoluta e revogação no logout.

**Pode evoluir** (hipótese futura, não decidida por este ADR): autenticação corporativa real no lugar do login simulado (ADR-004, alternativa B), e armazenamento das sessões fora do SQLite local, junto com a evolução da persistência do web (ADR-011).

## Rastreabilidade

- README §3 (Tela 1) e §8 (login simulado, identidade, chaves fora do código).
- Domain Model v2.18: §3.1 (`Employee`, login simulado).
- ADR-002 (autenticação no web), ADR-004 (identidade da sessão) e ADR-011 (banco do web; o mecanismo de sessão estava fora do escopo).
- `04-http-contract.md` v1.4: §2.2 (cabeçalhos do ator) e §10 (`POST /employees/lookup`).
