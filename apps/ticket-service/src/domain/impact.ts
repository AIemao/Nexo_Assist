export type AffectedScope = "SELF" | "TEAM" | "COMPANY" | "UNKNOWN";
export type WorkImpact = "BLOCKED" | "DEGRADED_WITH_WORKAROUND" | "NONE";
export type CommitmentRisk = "YES" | "NO" | "UNKNOWN" | "NOT_ASKED";

export interface ImpactAssessment {
  affectedScope: AffectedScope;
  workImpact: WorkImpact;
  commitmentRisk: CommitmentRisk;
}

export type ImpactAssessmentDraft = Partial<ImpactAssessment>;
