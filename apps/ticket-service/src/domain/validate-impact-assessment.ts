import type { ImpactAssessment } from "./impact.js";

export type ImpactValidation =
  | { ok: true }
  | { ok: false; error: "NOT_ASKED_REQUIRES_BLOCKED" };

// DM §5: commitmentRisk "NOT_ASKED" só é válido com workImpact "BLOCKED".
export function validateImpactAssessment(assessment: ImpactAssessment): ImpactValidation {
  if (assessment.commitmentRisk === "NOT_ASKED" && assessment.workImpact !== "BLOCKED") {
    return { ok: false, error: "NOT_ASKED_REQUIRES_BLOCKED" };
  }
  return { ok: true };
}
