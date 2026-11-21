import { currentDueAt, ticketOverdue, type Ticket } from "../domain/index.js";
import type { UnitOfWork } from "../persistence/unit-of-work.js";

// Contrato §8 (listagem) e §12 (vencido). O caso de uso recebe só o requesterId já
// verificado pela camada HTTP (§7.2): sem Actor, não pode ser chamado com ANALYST.

// Chamado com os campos calculados pelo ticket-service (DM §7.2: sem cópia no web).
export interface TicketView {
  ticket: Ticket;
  currentDueAt: string;
  isOverdue: boolean | null;
}

export interface ListMyTicketsInput {
  requesterId: string;
}

export interface ReadTicketsDependencies {
  unitOfWork: UnitOfWork;
  clock: { now(): string };
}

// DM §3.2 e §8.5.2: prazo vigente e vencido (RESOLVED → null), com o mesmo `now`.
export function toTicketView(ticket: Ticket, now: string): TicketView {
  return { ticket, currentDueAt: currentDueAt(ticket), isOverdue: ticketOverdue(ticket, now) };
}

export function createListMyTickets({ unitOfWork, clock }: ReadTicketsDependencies) {
  return {
    async execute({ requesterId }: ListMyTicketsInput): Promise<TicketView[]> {
      // ADR-008: leitura pela Unit of Work, em transação curta.
      const tickets = await unitOfWork.execute(({ tickets }) => tickets.listByRequester(requesterId));
      const now = clock.now();
      return tickets.map((ticket) => toTicketView(ticket, now));
    },
  };
}
