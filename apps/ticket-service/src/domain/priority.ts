import type { MissingField, PriorityReasonCode } from "./catalogs.js";

export const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type Priority = (typeof PRIORITIES)[number];

export type PriorityClassification =
  | { status: "CLASSIFIED"; priority: Priority; reasonCode: PriorityReasonCode }
  | { status: "NEEDS_CLARIFICATION"; missingFields: MissingField[]; reasonCode: PriorityReasonCode };
