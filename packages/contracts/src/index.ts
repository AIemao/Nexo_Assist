// Catálogos compartilhados pelo ticket-service e pelo web (README §5, Princípios, "Escopo do
// packages/contracts"). Só arrays `as const` e os tipos derivados: sem regras de negócio e sem
// dependências. Nomes, valores e ordem iguais aos do DM e do domínio do ticket-service.

// DM §3.2.
export const TICKET_TYPES = ["INC", "REQ"] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

// DM §3.2.
export const TICKET_CATEGORIES = [
  "ACCESS",
  "NETWORK_VPN",
  "HARDWARE",
  "SOFTWARE",
  "EMAIL",
  "OTHER",
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

// DM §3.2.
export const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type Priority = (typeof PRIORITIES)[number];

// DM §3.2 e §8.5.
export const TICKET_STATUSES = ["WAITING_ANALYST", "APPROVED", "RESOLVED"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

// DM §3.4.
export const AFFECTED_SCOPES = ["SELF", "TEAM", "COMPANY", "UNKNOWN"] as const;
export type AffectedScope = (typeof AFFECTED_SCOPES)[number];

export const WORK_IMPACTS = ["BLOCKED", "DEGRADED_WITH_WORKAROUND", "NONE"] as const;
export type WorkImpact = (typeof WORK_IMPACTS)[number];

export const COMMITMENT_RISKS = ["YES", "NO", "UNKNOWN", "NOT_ASKED"] as const;
export type CommitmentRisk = (typeof COMMITMENT_RISKS)[number];

// DM §3.15.
export const MISSING_FIELDS = [
  "TITLE",
  "DESCRIPTION",
  "TYPE",
  "CATEGORY",
  "AFFECTED_SCOPE",
  "WORK_IMPACT",
  "COMMITMENT_RISK",
  "TARGET_TICKET",
  "ADDITIONAL_INFORMATION",
  "REOPEN_REASON",
] as const;
export type MissingField = (typeof MISSING_FIELDS)[number];
