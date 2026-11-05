export const AFFECTED_SCOPES = ["SELF", "TEAM", "COMPANY", "UNKNOWN"] as const;
export type AffectedScope = (typeof AFFECTED_SCOPES)[number];

export const WORK_IMPACTS = ["BLOCKED", "DEGRADED_WITH_WORKAROUND", "NONE"] as const;
export type WorkImpact = (typeof WORK_IMPACTS)[number];

export const COMMITMENT_RISKS = ["YES", "NO", "UNKNOWN", "NOT_ASKED"] as const;
export type CommitmentRisk = (typeof COMMITMENT_RISKS)[number];

export interface ImpactAssessment {
  affectedScope: AffectedScope;
  workImpact: WorkImpact;
  commitmentRisk: CommitmentRisk;
}

export type ImpactAssessmentDraft = Partial<ImpactAssessment>;
