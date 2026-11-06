import type { JsonValue } from "./json.js";

// DM §3.9.
export const TICKET_EVENT_TYPES = [
  "CREATED",
  "UPDATED",
  "REOPENED",
  "TRANSFERRED",
  "ASSIGNED",
  "STATUS_CHANGED",
] as const;
export type TicketEventType = (typeof TICKET_EVENT_TYPES)[number];

export const ACTOR_TYPES = ["EMPLOYEE", "ANALYST", "SYSTEM"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

// Contrato dos elementos de changes: PENDENTE até a operação UPDATED (DM §3.9).
export interface TicketEvent {
  id: string;
  ticketId: string;
  type: TicketEventType;
  actor: { type: ActorType; employeeId?: string };
  summary: string;
  changes: JsonValue[];
  occurredAt: string;
}
