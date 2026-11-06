import type { TicketType } from "./ticket.js";

// DM §3.2: `n` vem do contador do tipo; começa em 1, sem zeros à esquerda.
export function formatTicketId(type: TicketType, n: number): string {
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new RangeError(`Número de chamado inválido: ${n}`);
  }
  return `${type}-${n}`;
}
