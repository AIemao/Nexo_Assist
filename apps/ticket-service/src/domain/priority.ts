import type { MissingField, PriorityReasonCode } from "./catalogs.js";

export type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type PriorityClassification =
  | { status: "CLASSIFIED"; priority: Priority; reasonCode: PriorityReasonCode }
  | { status: "NEEDS_CLARIFICATION"; missingFields: MissingField[]; reasonCode: PriorityReasonCode };
