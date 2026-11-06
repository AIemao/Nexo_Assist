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

// DM §3.9: a regra do ator (employeeId só para EMPLOYEE e ANALYST) fica no tipo.
export type Actor =
  | { type: "EMPLOYEE" | "ANALYST"; employeeId: string }
  | { type: "SYSTEM" };

// Contrato dos elementos de changes: PENDENTE até a operação UPDATED (DM §3.9).
export interface TicketEvent {
  id: string;
  ticketId: string;
  type: TicketEventType;
  actor: Actor;
  summary: string;
  changes: JsonValue[];
  occurredAt: string;
}
