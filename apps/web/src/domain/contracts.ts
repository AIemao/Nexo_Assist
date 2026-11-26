// Tipos dos catálogos compartilhados (packages/contracts) usados nos contratos do web.
import type { AffectedScope, CommitmentRisk, WorkImpact } from "@nexo/contracts";

export type { TicketCategory, TicketType } from "@nexo/contracts";

// DM §3.4: ImpactAssessmentDraft = Partial<ImpactAssessment>.
export interface ImpactAssessmentDraftShape {
  affectedScope?: AffectedScope;
  workImpact?: WorkImpact;
  commitmentRisk?: CommitmentRisk;
}
