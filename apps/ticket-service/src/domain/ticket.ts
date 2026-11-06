import type { ImpactAssessment } from "./impact.js";
import type { Priority } from "./priority.js";
import type { TicketStatus } from "./ticket-status.js";

// DM §3.2.
export const TICKET_TYPES = ["INC", "REQ"] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const TICKET_CATEGORIES = [
  "ACCESS",
  "NETWORK_VPN",
  "HARDWARE",
  "SOFTWARE",
  "EMAIL",
  "OTHER",
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

// DM §3.2. Campos opcionais com `?` (nunca null); datas em string ISO 8601.
export interface Ticket {
  id: string;
  version: number;
  type: TicketType;
  title: string;
  description: string;
  category: TicketCategory;
  priority: Priority;
  status: TicketStatus;
  requesterId: string;
  impactAssessment: ImpactAssessment;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  firstResponseDueAt: string;
  nextUpdateDueAt?: string;
  serviceDeskUpdatedAt?: string;
}
