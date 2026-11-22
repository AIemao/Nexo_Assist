import type { TicketStatus } from "@nexo/contracts";

import type { Ticket } from "./ticket.js";

// DM §3.2 e §8.5. Fonte única no packages/contracts (README §5, Princípios).
export { TICKET_STATUSES } from "@nexo/contracts";
export type { TicketStatus } from "@nexo/contracts";

// DM §8.5: [PRD] reabertura "até 7 dias"; [Premissa] 168 horas corridas, limite incluído.
const REOPEN_WINDOW_MS = 168 * 60 * 60 * 1000;

// DM §8.5: "aberto" = status diferente de RESOLVED.
export function isOpenTicket(status: TicketStatus): boolean {
  return status !== "RESOLVED";
}

// Recebe só os campos que a regra usa. `now` é parâmetro: o domínio não lê relógio.
export function canReopen(
  ticket: Pick<Ticket, "status" | "resolvedAt">,
  now: string,
): boolean {
  if (ticket.status !== "RESOLVED" || ticket.resolvedAt === undefined) {
    return false;
  }
  const resolvedAtMs = Date.parse(ticket.resolvedAt);
  const nowMs = Date.parse(now);
  if (Number.isNaN(resolvedAtMs) || Number.isNaN(nowMs)) {
    return false;
  }
  return nowMs <= resolvedAtMs + REOPEN_WINDOW_MS;
}
