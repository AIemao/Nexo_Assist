import { z } from "zod";
import { errorTypeOf, type ErrorLogger } from "../observability/error-log";
import type { EmployeeActor, TicketServiceClient } from "../ticket-service/client";
import { TicketServiceRejectedError, TicketServiceUnavailableError } from "./errors";

// Execução da listMyTickets (plano PW-3; desvio D-2 da W8.3). Descrição e schema de entrada são os da
// V4: nenhum argumento, schema estrito (tag spike-adr-009, src/tools.ts:27). Só o resultado muda: os
// seis campos da V4 (test/baseline/v4/results-descriptor.json) mais currentDueAt e isOverdue, como o
// ticket-service os entrega, sem recalcular.
export const listMyTicketsInputSchema = z.strictObject({});
export type ListMyTicketsArgs = z.infer<typeof listMyTicketsInputSchema>;

// Montado pelo código a partir da sessão, nunca pelo modelo.
export interface TicketReadContext {
  actor: EmployeeActor;
}

export interface TicketReadDeps {
  ticketService: Pick<TicketServiceClient, "listMyTickets" | "viewTicket">;
  logError: ErrorLogger;
}

export interface ListedTicket {
  id: string;
  type: string;
  category: string;
  title: string;
  priority: string;
  status: string;
  currentDueAt: string;
  isOverdue: boolean | null;
}

export type ListMyTicketsOutcome =
  | { status: "SUCCESS"; result: { tickets: ListedTicket[] }; meta: { ticketIds: string[] } }
  | { status: "FAILED"; result: { available: false } };

export async function executeListMyTickets(
  _args: ListMyTicketsArgs,
  context: TicketReadContext,
  deps: TicketReadDeps,
): Promise<ListMyTicketsOutcome> {
  try {
    // Só o actor chega ao cliente: os argumentos não têm nada a repassar.
    const response = await deps.ticketService.listMyTickets(context.actor);
    if (response.kind === "unavailable") throw new TicketServiceUnavailableError();
    if (response.kind === "rejected") throw new TicketServiceRejectedError();
    // Ordem dos seis campos da V4 (id, type, category, title, priority, status), depois os dois do D-2.
    const tickets = response.tickets.map((ticket) => ({
      id: ticket.id,
      type: ticket.type,
      category: ticket.category,
      title: ticket.title,
      priority: ticket.priority,
      status: ticket.status,
      currentDueAt: ticket.currentDueAt,
      isOverdue: ticket.isOverdue,
    }));
    return { status: "SUCCESS", result: { tickets }, meta: { ticketIds: tickets.map((t) => t.id) } };
  } catch (error) {
    deps.logError({ context: "tickets", errorType: errorTypeOf(error) });
    return { status: "FAILED", result: { available: false } };
  }
}
