# ADR-004 — Identidade da sessão, login simulado, analista com auditoria e autorização por origem da escrita

- **Status:** Aceito
- **Data:** 2026-11-02
- **Bloco:** 1

De onde vem a identidade de quem age, e como se autoriza e audita cada tipo de ação?

## Contexto

O PRD diz que a informação de um chamado só vai para quem o abriu, e também que analistas recebem chamados e atendem conversas transferidas. O README interpreta a privacidade como proteção **entre funcionários**, e o service desk exerce sua função (README §8, **[Premissa]**). A autenticação é simulada no ambiente demonstrativo, como o PRD permite.

## Decisão

- **A identidade vem da sessão.** As tools não têm parâmetro `userId`, e o backend injeta o usuário autenticado. Identidade e papel nunca são aceitos como parâmetro fornecido pelo LLM (README §8).
- **O ticket-service valida o solicitante** em toda leitura e escrita de funcionário, como defesa em profundidade.
- **O login é simulado**, conforme o escopo demonstrativo (README §8).
- **O analista trabalha pelo console, com auditoria.** Consultas geram `TicketAccessLog`. Mutações geram `TicketEvent` com `actor.type = ANALYST` (DM §3.10, §7.1 invariante 2).
- **A autorização depende da origem da escrita** (DM §7.1 invariante 5):
  - solicitação do funcionário: `PendingAction` confirmada;
  - handoff: política de transferência;
  - console: papel `ANALYST`.

**Pendente (Bloco 7):** a política detalhada de autorização das escritas do console pelo papel `ANALYST`. Este ADR registra a direção (autorização própria, com auditoria) e não fecha esse contrato.

**Pior caso.** Um modelo manipulado não consegue consultar o chamado de terceiro trocando um identificador. A identidade vem da sessão e o ticket-service valida o solicitante.

## Alternativas consideradas

### A. O LLM fornece `userId` e o backend valida

É a alternativa concorrente mais forte. Parece simples, cada tool receberia o solicitante de forma explícita, e a validação no backend ainda protegeria o acesso. Foi rejeitada porque:
- A identidade não deve depender de um parâmetro controlado pelo modelo.
- O parâmetro cria superfície para prompt injection e confusão de identidade.
- Se o backend já precisa resolver e validar a identidade real da sessão, o `userId` do modelo não acrescenta autoridade nem segurança.

A validação no ticket-service continua necessária mesmo com a identidade injetada pela sessão.

### B. Autenticação real (SSO/OAuth)

Aproxima o sistema de um ambiente corporativo. Está fora do escopo demonstrativo atual e é evolução possível. O README não afirma autenticação corporativa real (README §8).

### C. Analista sem acesso, ou com acesso irrestrito e sem auditoria

A primeira opção impede o service desk de trabalhar. A segunda compromete a rastreabilidade. A decisão é acesso pelo console, com auditoria.

## Consequências

**Positivas**
- Identidade confiável e defesa em profundidade.
- Acesso de funcionário e de analista separados.
- Trilha de auditoria de consultas e mutações.

**Negativas e custos**
- Mais verificações e mais registros.
- Cuidado com retenção e privacidade dos próprios dados de auditoria.

## E se o produto crescer para 20 mil funcionários?

**Permanece:** identidade vinda da sessão, validação no ticket-service e auditoria.

**Pode evoluir** (hipóteses futuras, não aprovadas nem implementadas):
- Login simulado para SSO.
- Permissões por equipe e nível de acesso (README §8 já indica essa direção para produção).
- Volume, consulta e retenção de `TicketAccessLog`.
- Políticas mais granulares para analistas.

Nenhuma dessas evoluções elimina a validação no backend nem a auditoria.

## Rastreabilidade

- README §8 (premissa de interpretação, proteções).
- Domain Model v2.2: §3.10 (`TicketAccessLog`) e §7.1 (invariantes 1, 2 e 5, tabela de origem das escritas).
- Pendência: DM §7.1 (`ASSIGN_TICKET` e política do console, Bloco 7).
