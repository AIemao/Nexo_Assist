import type { TicketCategory, TicketType } from "@nexo/contracts";

import type { ImpactAssessment } from "./impact.js";
import type { Priority } from "./priority.js";
import type { TicketStatus } from "./ticket-status.js";

// DM §3.2. Fonte única no packages/contracts (README §5, Princípios).
export { TICKET_TYPES } from "@nexo/contracts";
export type { TicketType } from "@nexo/contracts";

export { TICKET_CATEGORIES } from "@nexo/contracts";
export type { TicketCategory } from "@nexo/contracts";

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
