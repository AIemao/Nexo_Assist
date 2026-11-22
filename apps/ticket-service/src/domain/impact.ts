import type { AffectedScope, CommitmentRisk, WorkImpact } from "@nexo/contracts";

// DM §3.4. Fonte única no packages/contracts (README §5, Princípios).
export { AFFECTED_SCOPES } from "@nexo/contracts";
export type { AffectedScope } from "@nexo/contracts";

export { WORK_IMPACTS } from "@nexo/contracts";
export type { WorkImpact } from "@nexo/contracts";

export { COMMITMENT_RISKS } from "@nexo/contracts";
export type { CommitmentRisk } from "@nexo/contracts";

export interface ImpactAssessment {
  affectedScope: AffectedScope;
  workImpact: WorkImpact;
  commitmentRisk: CommitmentRisk;
}

export type ImpactAssessmentDraft = Partial<ImpactAssessment>;
