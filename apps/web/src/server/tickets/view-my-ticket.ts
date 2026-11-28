import { VIEW_MY_TICKET_NOT_FOUND, type viewMyTicketInputSchema } from "../agent/extensions/view-my-ticket";
import { errorTypeOf } from "../observability/error-log";
import type { z } from "zod";
import { TicketServiceRejectedError, TicketServiceUnavailableError } from "./errors";
import type { TicketReadContext, TicketReadDeps } from "./list-my-tickets";

// Execução da viewMyTicket (desvio D-1 da W8.3; plano PW-8; AF D17). O schema de entrada (estrito) é o
// do A5 e valida os argumentos antes (F7). O contrato HTTP não define formato de id (§9.2): id
// malformado vai ao ticket-service, que nega com o mesmo 404 TICKET_NOT_FOUND.
export type ViewMyTicketArgs = z.infer<typeof viewMyTicketInputSchema>;

export interface ViewedTicket {
  id: string;
  type: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  currentDueAt: string;
  isOverdue: boolean | null;
}

// Negação: saída inteira constante (status, result e meta), igual byte a byte para chamado inexistente,
// alheio e malformado. meta sem ticketId.
const NOT_FOUND_OUTCOME = Object.freeze({ status: "SUCCESS", result: VIEW_MY_TICKET_NOT_FOUND, meta: Object.freeze({}) } as const);

export type ViewMyTicketOutcome =
  | { status: "SUCCESS"; result: { found: true; ticket: ViewedTicket }; meta: { ticketId: string } }
  | typeof NOT_FOUND_OUTCOME
  | { status: "FAILED"; result: { available: false } };

export async function executeViewMyTicket(
  args: ViewMyTicketArgs,
  context: TicketReadContext,
  deps: TicketReadDeps,
): Promise<ViewMyTicketOutcome> {
  try {
    // Só o actor da sessão e o ticketId chegam ao cliente.
    const response = await deps.ticketService.viewTicket(context.actor, args.ticketId);
    if (response.kind === "not_found") return NOT_FOUND_OUTCOME;
    if (response.kind === "unavailable") throw new TicketServiceUnavailableError();
    if (response.kind === "rejected") throw new TicketServiceRejectedError();
    const t = response.ticket;
    // Projeção do A5, nesta ordem; resolvedAt só quando o ticket-service o envia (RESOLVED).
    const ticket: ViewedTicket = {
      id: t.id,
      type: t.type,
      title: t.title,
      description: t.description,
      category: t.category,
      priority: t.priority,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      ...(t.resolvedAt === undefined ? {} : { resolvedAt: t.resolvedAt }),
      currentDueAt: t.currentDueAt,
      isOverdue: t.isOverdue,
    };
    return { status: "SUCCESS", result: { found: true, ticket }, meta: { ticketId: t.id } };
  } catch (error) {
    deps.logError({ context: "tickets", errorType: errorTypeOf(error) });
    return { status: "FAILED", result: { available: false } };
  }
}
