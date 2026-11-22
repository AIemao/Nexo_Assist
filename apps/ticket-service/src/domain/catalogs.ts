// DM §3.15. Fonte única no packages/contracts (README §5, Princípios): derivado de MISSING_FIELDS.
export type { MissingField } from "@nexo/contracts";

export type PriorityReasonCode =
  | "TEAM_OR_COMPANY_BLOCKED" | "SELF_BLOCKED" | "AFFECTED_SCOPE_UNKNOWN"
  | "COMMITMENT_AT_RISK_TODAY" | "WORKAROUND_AVAILABLE" | "NO_WORK_IMPACT"
  | "WORK_IMPACT_MISSING" | "AFFECTED_SCOPE_MISSING" | "COMMITMENT_RISK_MISSING";
