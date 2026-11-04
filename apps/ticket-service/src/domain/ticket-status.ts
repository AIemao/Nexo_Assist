export type TicketStatus = "WAITING_ANALYST" | "APPROVED" | "RESOLVED";

// DM §8.5: [PRD] reabertura "até 7 dias"; [Premissa] 168 horas corridas, limite incluído.
const REOPEN_WINDOW_MS = 168 * 60 * 60 * 1000;

// DM §8.5: "aberto" = status diferente de RESOLVED.
export function isOpenTicket(status: TicketStatus): boolean {
  return status !== "RESOLVED";
}

// O parâmetro equivale a Pick<Ticket, "status" | "resolvedAt">; o Ticket completo
// ainda não está modelado no código. `now` é parâmetro: o domínio não lê relógio.
export function canReopen(
  ticket: { status: TicketStatus; resolvedAt?: string },
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
