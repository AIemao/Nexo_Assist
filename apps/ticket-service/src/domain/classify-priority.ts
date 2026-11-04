import type { ImpactAssessmentDraft } from "./impact.js";
import type { PriorityClassification } from "./priority.js";

// DM §4: a primeira regra que casa vence.
export function classifyPriority(assessment: ImpactAssessmentDraft): PriorityClassification {
  const { workImpact, affectedScope, commitmentRisk } = assessment;

  // Regra 0: workImpact ausente
  if (workImpact === undefined) {
    return { status: "NEEDS_CLARIFICATION", missingFields: ["WORK_IMPACT"], reasonCode: "WORK_IMPACT_MISSING" };
  }

  if (workImpact === "BLOCKED") {
    // Regra 1: BLOCKED + affectedScope ausente
    if (affectedScope === undefined) {
      return { status: "NEEDS_CLARIFICATION", missingFields: ["AFFECTED_SCOPE"], reasonCode: "AFFECTED_SCOPE_MISSING" };
    }
    // Regra 2: BLOCKED + TEAM ou COMPANY
    if (affectedScope === "TEAM" || affectedScope === "COMPANY") {
      return { status: "CLASSIFIED", priority: "CRITICAL", reasonCode: "TEAM_OR_COMPANY_BLOCKED" };
    }
    // Regra 3: BLOCKED + SELF
    if (affectedScope === "SELF") {
      return { status: "CLASSIFIED", priority: "HIGH", reasonCode: "SELF_BLOCKED" };
    }
    // Regra 4: BLOCKED + UNKNOWN (erro de compilação se AffectedScope ganhar outro valor)
    affectedScope satisfies "UNKNOWN";
    return { status: "CLASSIFIED", priority: "HIGH", reasonCode: "AFFECTED_SCOPE_UNKNOWN" };
  }

  // Regra 5: commitmentRisk ausente
  if (commitmentRisk === undefined) {
    return { status: "NEEDS_CLARIFICATION", missingFields: ["COMMITMENT_RISK"], reasonCode: "COMMITMENT_RISK_MISSING" };
  }
  // Regra 6: commitmentRisk = YES
  if (commitmentRisk === "YES") {
    return { status: "CLASSIFIED", priority: "HIGH", reasonCode: "COMMITMENT_AT_RISK_TODAY" };
  }
  // Regra 7: DEGRADED_WITH_WORKAROUND
  if (workImpact === "DEGRADED_WITH_WORKAROUND") {
    return { status: "CLASSIFIED", priority: "MEDIUM", reasonCode: "WORKAROUND_AVAILABLE" };
  }
  // Regra 8: NONE (erro de compilação se WorkImpact ganhar outro valor)
  workImpact satisfies "NONE";
  return { status: "CLASSIFIED", priority: "LOW", reasonCode: "NO_WORK_IMPACT" };
}
