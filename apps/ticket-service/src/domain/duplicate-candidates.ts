import { isOpenTicket } from "./ticket-status.js";
import type { TicketStatus } from "./ticket-status.js";
import type { TicketCategory, TicketType } from "./ticket.js";

// Equivale a Pick<Ticket, "id" | "requesterId" | "type" | "category" | "status" | "updatedAt">;
// o Ticket completo ainda não está modelado no código.
export type DuplicateCandidateTicket = {
  id: string;
  requesterId: string;
  type: TicketType;
  category: TicketCategory;
  status: TicketStatus;
  updatedAt: string;
};

// DM §8.5.1: candidato = mesmo solicitante, tipo e categoria, chamado aberto e id fora de dismissedIds.
// requesterId vem da sessão (ADR-004), nunca do rascunho nem do LLM.
export function findDuplicateCandidates(
  requesterId: string,
  criteria: { type: TicketType; category: TicketCategory },
  tickets: readonly DuplicateCandidateTicket[],
  dismissedIds: ReadonlySet<string>,
): DuplicateCandidateTicket[] {
  // filter devolve um array novo: o sort abaixo não toca no array recebido.
  return tickets
    .filter(
      (t) =>
        t.requesterId === requesterId &&
        t.type === criteria.type &&
        t.category === criteria.category &&
        isOpenTicket(t.status) &&
        !dismissedIds.has(t.id),
    )
    .sort((a, b) => {
      // updatedAt decrescente, comparando instantes (não texto); desempate por id crescente.
      const porInstante = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      if (porInstante !== 0) return porInstante;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}
