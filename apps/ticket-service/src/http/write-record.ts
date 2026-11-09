import type { SimulatedFault } from "./simulated-fault.js";

// Registro de uma requisição de escrita (cenários §1.1, IN2–IN6). O app produz este
// objeto; o instante (`at`, IN4) não faz parte dele: quem o carimba é o gravador do
// main.ts, ao escrever a linha no stdout. Assim o app não precisa de relógio.
export type WriteRecord = {
  event: "ticket_write";
  // IN4: valor do TicketOperationType (DM §3.16), o mesmo de IdempotencyRecord.operationType.
  operation: "CREATE";
  outcome: "CREATED" | "REPLAYED" | "REJECTED" | "INVALID" | "ERROR" | "NOT_EXECUTED";
  status?: number;
  code?: string;
  idempotencyKey?: string;
  ticketId?: string;
  fault?: SimulatedFault["mode"];
  responseDisposition: "SENT" | "DROPPED";
};
