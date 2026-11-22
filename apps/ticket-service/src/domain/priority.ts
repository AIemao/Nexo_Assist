import type { Priority } from "@nexo/contracts";

import type { MissingField, PriorityReasonCode } from "./catalogs.js";

// DM §3.2. Fonte única no packages/contracts (README §5, Princípios).
export { PRIORITIES } from "@nexo/contracts";
export type { Priority } from "@nexo/contracts";

export type PriorityClassification =
  | { status: "CLASSIFIED"; priority: Priority; reasonCode: PriorityReasonCode }
  | { status: "NEEDS_CLARIFICATION"; missingFields: MissingField[]; reasonCode: PriorityReasonCode };
