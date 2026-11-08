# ADR-005 — Idempotência e duplicidade como mecanismos distintos

- **Status:** Aceito
- **Data:** 2026-11-02
- **Bloco:** 1

Como evitar que uma operação seja executada duas vezes, sem confundir isso com abrir dois chamados para o mesmo problema?

## Contexto

O ticket-service é "legado" e fica indisponível por alguns segundos, de propósito (README §9). Um timeout deixa o resultado desconhecido, e a tentativa seguinte não pode duplicar nem falhar por causa da própria operação anterior. Separadamente, um novo pedido pode tratar de um problema que já tem chamado aberto.

## Decisão

- **Chave de idempotência = `OperationExecution.id`**, criado e persistido **antes** da chamada ao ticket-service e reutilizado em todas as tentativas da mesma operação (DM §3.14, invariantes 10 e 11).
- **O ticket-service consulta a chave antes de verificar `expectedTicketVersion`.** Se a operação já foi concluída, devolve o resultado original (README §9).
- **A reconciliação é repetir a operação com o mesmo `id`** (DM §8.4).
- **Idempotência e duplicidade são mecanismos distintos:**
  - idempotência impede executar mais de uma vez a mesma operação técnica;
  - duplicidade identifica se o problema já tem chamado e evita abrir outro.
- O ticket-service é a autoridade das duas regras (README §9).

## Alternativas consideradas

### A. Usar `pendingActionId` como chave

É a alternativa concorrente mais forte: uma confirmação autoriza uma operação, então a própria ação pendente poderia identificar a execução. Para operações que nascem de uma confirmação, funcionaria. Foi rejeitada porque não cobre o contrato completo.

`TRANSFER_TICKET` tem `OperationExecution` **sem** `PendingAction` (DM §3.14). A chave precisa identificar qualquer operação executável, inclusive as que não nascem de uma autorização de funcionário. A identidade da execução pertence a `OperationExecution`, não à proposta que eventualmente a originou.

### B. Deduplicar por conteúdo (solicitante e texto)

Parece detectar chamadas repetidas. Confunde a repetição técnica da mesma operação com dois pedidos de negócio parecidos. O conteúdo não identifica a execução.

### C. Verificar a versão antes da chave

Depois de uma atualização bem-sucedida, a versão do chamado avança. Se a resposta original se perdeu, o retry seria rejeitado como "versão desatualizada" mesmo sendo a mesma operação já executada (README §9).

## Consequências

**Positivas**

- Retry seguro e reconciliação simples.
- Proteção contra duplicação técnica, sem misturá-la com a regra de negócio de duplicidade.

**Negativas e custos**

- Persistir a execução antes da chamada.
- Guardar resultados associados às chaves, para poder devolvê-los na reconciliação.
- Pendente (Bloco 3): endpoint específico de consulta pela chave, política de retry e recuperação após reinício (README §9; DM §8.4).

**Atualização (2026-11-07).** Nota posterior à decisão. O texto acima fica como registro histórico, e a decisão deste ADR não muda.

- **Resolvido:** o endpoint específico de consulta pela chave é opcional e não faz parte do MVP. Repetir a operação com a mesma chave reconcilia o resultado original (DM v2.11 §3.16; README §12 #8; contrato HTTP, [`04-http-contract.md`](../architecture/04-http-contract.md) §5).
- **Resolvido:** a responsabilidade pela política de retry é do cliente web/BFF. Retries da mesma intenção reutilizam a mesma chave e o mesmo corpo original, e o ticket-service não tem laço de retry (DM v2.11 §§3.16 e 8.4; README §12 #7; contrato HTTP §5).
- **Movido para o Bloco 5:** o detalhamento operacional da política de retry (timeout, backoff, limite de tentativas, classificação de erros transitórios × definitivos) e a recuperação após reinício do cliente web/BFF. Motivo: o Bloco 5 é o da primeira escrita do web no ticket-service e das operações `UPDATE` e `REOPEN`, onde essa política é exercida (DM v2.11 §8.4 e §10: PENDENTE quando o web existir; README §12 #7).

## E se o produto crescer para 20 mil funcionários?

**Permanece:** a chave pertence à execução, e a ordem de verificação (chave antes da versão) continua valendo.

**Pode evoluir** (hipóteses futuras): capacidade de armazenamento das chaves, política de retenção e expiração, e processamento por filas e workers.

## Rastreabilidade

- README §9 (idempotência x duplicidade, fluxo, ordem no ticket-service, reconciliação).
- Domain Model v2.2: §3.14 (`OperationExecution`), §7.1 (invariantes 10 e 11) e §8.4.
