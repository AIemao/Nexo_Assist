// Registro de uma requisição de leitura de chamados (cenários §1.1, IL1–IL7). O app produz
// este objeto; o instante (`at`) é carimbado pelo gravador do main.ts, como no ticket_write.

// IL6: operações do ticket-service, independentes de quem chama; não são valores da Intent.
// Definidas uma vez (README §12 #18).
export const READ_OPERATIONS = ["LIST", "VIEW"] as const;
export type ReadOperation = (typeof READ_OPERATIONS)[number];

// IL6: OK (200), INVALID (400), REJECTED (403 e 404: recusada pela regra de acesso ou pelo
// caso de uso) e ERROR (500). NOT_EXECUTED não se aplica: não há falha simulada nas leituras.
export const READ_OUTCOMES = ["OK", "INVALID", "REJECTED", "ERROR"] as const;
export type ReadOutcome = (typeof READ_OUTCOMES)[number];

// IL6: sem idempotencyKey, sem fault e sem id do funcionário; ticketId só no 200 do VIEW;
// responseDisposition sempre SENT.
export type ReadRecord = {
  event: "ticket_read";
  operation: ReadOperation;
  outcome: ReadOutcome;
  status: number;
  code?: string;
  ticketId?: string;
  responseDisposition: "SENT";
};
