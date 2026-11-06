import type { Ticket } from "./ticket.js";
import { validateImpactAssessment } from "./validate-impact-assessment.js";

export type TicketInvariantError =
  | "UPDATE_DEADLINE_PAIR"
  | "RESOLVED_AT_STATUS"
  | "APPROVED_REQUIRES_REQ"
  | "NOT_ASKED_REQUIRES_BLOCKED";

// DM §3.2: regras entre campos que o schema não expressa, validadas antes da gravação.
// Acumula todas as violações, nesta ordem: prazo, resolução, aprovação, impacto.
export function validateTicketInvariants(
  ticket: Ticket,
): { ok: true } | { ok: false; errors: TicketInvariantError[] } {
  const errors: TicketInvariantError[] = [];

  // nextUpdateDueAt e serviceDeskUpdatedAt: ambos presentes ou ambos ausentes.
  if ((ticket.nextUpdateDueAt !== undefined) !== (ticket.serviceDeskUpdatedAt !== undefined)) {
    errors.push("UPDATE_DEADLINE_PAIR");
  }

  // resolvedAt presente se e só se status = RESOLVED.
  if ((ticket.status === "RESOLVED") !== (ticket.resolvedAt !== undefined)) {
    errors.push("RESOLVED_AT_STATUS");
  }

  // APPROVED só para type REQ (DM §8.5).
  if (ticket.status === "APPROVED" && ticket.type !== "REQ") {
    errors.push("APPROVED_REQUIRES_REQ");
  }

  // NOT_ASKED só com BLOCKED: a regra vive em validateImpactAssessment (DM §5.1).
  const impact = validateImpactAssessment(ticket.impactAssessment);
  if (!impact.ok) {
    errors.push(impact.error);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
