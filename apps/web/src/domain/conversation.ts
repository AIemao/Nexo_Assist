// Catálogos e contratos da conversa no web (DM v2.19 §3.5 e §3.8; AF §3). Arrays `as const` como
// fonte única; o schema.prisma reproduz cada catálogo persistido como enum, e um teste de tipo
// verifica a igualdade nos dois sentidos (README §5, "Catálogos persistidos"). Módulo puro: sem
// Prisma, sem Zod e sem dependências, para poder ser usado também no cliente.
import type { ImpactAssessmentDraftShape, TicketCategory, TicketType } from "./contracts";

// DM §3.5.
export const CONVERSATION_STATUSES = ["AI_ACTIVE", "WAITING_ANALYST", "ANALYST_ACTIVE", "CLOSED"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const INTERACTION_FLOWS = ["NONE", "CREATE_TICKET", "UPDATE_TICKET", "REOPEN_TICKET", "TICKET_LOOKUP"] as const;
export type InteractionFlow = (typeof INTERACTION_FLOWS)[number];

export const INTERACTION_STAGES = ["IDLE", "COLLECTING_DETAILS", "SELECTING_TICKET", "READY_TO_PROPOSE"] as const;
export type InteractionStage = (typeof INTERACTION_STAGES)[number];

export const RESOLUTION_SOURCES = ["AGENT", "ANALYST"] as const;
export type ResolutionSource = (typeof RESOLUTION_SOURCES)[number];

// AF §3: as 10 combinações válidas de (flow, stage). Qualquer outra é inválida e não é persistida.
export const VALID_FLOW_STAGES = [
  ["NONE", "IDLE"],
  ["TICKET_LOOKUP", "SELECTING_TICKET"],
  ["CREATE_TICKET", "COLLECTING_DETAILS"],
  ["CREATE_TICKET", "READY_TO_PROPOSE"],
  ["UPDATE_TICKET", "SELECTING_TICKET"],
  ["UPDATE_TICKET", "COLLECTING_DETAILS"],
  ["UPDATE_TICKET", "READY_TO_PROPOSE"],
  ["REOPEN_TICKET", "SELECTING_TICKET"],
  ["REOPEN_TICKET", "COLLECTING_DETAILS"],
  ["REOPEN_TICKET", "READY_TO_PROPOSE"],
] as const satisfies readonly (readonly [InteractionFlow, InteractionStage])[];

export function isValidFlowStage(flow: InteractionFlow, stage: InteractionStage): boolean {
  return VALID_FLOW_STAGES.some(([validFlow, validStage]) => validFlow === flow && validStage === stage);
}

// DM §3.5.
export interface CollectedData {
  title?: string;
  description?: string;
  type?: TicketType;
  category?: TicketCategory;
  impactAssessment?: ImpactAssessmentDraftShape;
  additionalInformation?: string;
  reason?: string;
}

export interface InteractionContext {
  flow: InteractionFlow;
  stage: InteractionStage;
  targetTicketId?: string;
  collectedData?: CollectedData;
}

export interface Conversation {
  id: string;
  ownerEmployeeId: string;
  status: ConversationStatus;
  assignedAnalystId?: string;
  interactionContext: InteractionContext;
  resolutionSource?: ResolutionSource;
  createdAt: string;
  updatedAt: string;
}

// DM §3.8.
export const MESSAGE_AUTHOR_TYPES = ["EMPLOYEE", "ANALYST", "AGENT", "SYSTEM"] as const;
export type MessageAuthorType = (typeof MESSAGE_AUTHOR_TYPES)[number];

export type MessageAuthor =
  | { type: "EMPLOYEE"; employeeId: string }
  | { type: "ANALYST"; employeeId: string }
  | { type: "AGENT" }
  | { type: "SYSTEM" };

export const MESSAGE_ATTACHMENT_KINDS = ["PENDING_ACTION", "TICKET", "TICKET_SELECTOR", "QUICK_REPLIES"] as const;
export type MessageAttachmentKind = (typeof MESSAGE_ATTACHMENT_KINDS)[number];

export interface MessageAttachment {
  kind: MessageAttachmentKind;
  refId: string;
}

export interface Message {
  id: string;
  conversationId: string;
  author: MessageAuthor;
  content: string;
  decisionRecordId?: string;
  attachments: MessageAttachment[];
  createdAt: string;
}
