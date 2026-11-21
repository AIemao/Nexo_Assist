import type { ReadTicketsDependencies, TicketView } from "./list-my-tickets.js";
import { toTicketView } from "./list-my-tickets.js";

// Contrato §9 (consulta detalhada) e §12 (vencido). O caso de uso recebe só o requesterId já
// verificado pela camada HTTP (§7.2). A busca é uma única consulta por id e requesterId
// (§9.2): inexistente, de outro funcionário e malformado dão o mesmo TICKET_NOT_FOUND.

export interface ViewMyTicketInput {
  requesterId: string;
  ticketId: string;
}

export type ViewMyTicketResult = { ok: true; view: TicketView } | { ok: false; error: "TICKET_NOT_FOUND" };

export function createViewMyTicket({ unitOfWork, clock }: ReadTicketsDependencies) {
  return {
    async execute({ requesterId, ticketId }: ViewMyTicketInput): Promise<ViewMyTicketResult> {
      // ADR-008: leitura pela Unit of Work, em transação curta.
      const ticket = await unitOfWork.execute(({ tickets }) => tickets.findByIdAndRequester(ticketId, requesterId));
      if (ticket === undefined) return { ok: false, error: "TICKET_NOT_FOUND" };
      return { ok: true, view: toTicketView(ticket, clock.now()) };
    },
  };
}
