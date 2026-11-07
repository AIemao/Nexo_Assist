import type { ImpactAssessment } from "./impact.js";
import type { Priority } from "./priority.js";
import type { TicketCategory, TicketType } from "./ticket.js";

// DM §3.3, variante de criação. priority e firstResponseDueAt vêm da prévia:
// a prioridade é revalidada e o prazo é recalculado na criação.
export interface CreateTicketDraft {
  operation: "CREATE_TICKET";
  title: string;
  description: string;
  type: TicketType;
  category: TicketCategory;
  impactAssessment: ImpactAssessment;
  priority: Priority;
  firstResponseDueAt: string;
}
