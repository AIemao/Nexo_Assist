import { z } from "zod";

// Interpretação de um turno do agent: `DecisionRecord.interpretation`, DM v2.13 §3.12.
// Os catálogos são copiados do DM (o spike não importa do ticket-service). Nada da
// interpretação está PENDENTE no DM: o que segue PENDENTE no §3.12 (catálogo de
// `appliedRules`, mapeamento PolicyOutcome × PolicyReasonCode) é da camada de política,
// que fica fora do spike.

// DM v2.13 §3.12, `type Intent` (catálogo fechado, 10 valores).
export const INTENTS = [
  "ANSWER_KB",
  "LIST_MY_TICKETS",
  "VIEW_TICKET",
  "CREATE_TICKET",
  "UPDATE_TICKET",
  "REOPEN_TICKET",
  "HANDOFF",
  "CLOSE_CONVERSATION",
  "OUT_OF_SCOPE",
  "CLARIFY",
] as const;

// DM v2.13 §3.12: "sinal auxiliar, NÃO probabilidade".
export const CONFIDENCES = ["LOW", "MEDIUM", "HIGH"] as const;

// DM v2.13 §3.2, `type TicketCategory`.
export const TICKET_CATEGORIES = ["ACCESS", "NETWORK_VPN", "HARDWARE", "SOFTWARE", "EMAIL", "OTHER"] as const;

// DM v2.13 §3.2, `TicketType`.
export const TICKET_TYPES = ["INC", "REQ"] as const;

// DM v2.13 §3.4.
export const AFFECTED_SCOPES = ["SELF", "TEAM", "COMPANY", "UNKNOWN"] as const;
export const WORK_IMPACTS = ["BLOCKED", "DEGRADED_WITH_WORKAROUND", "NONE"] as const;
export const COMMITMENT_RISKS = ["YES", "NO", "UNKNOWN", "NOT_ASKED"] as const;

// DM v2.13 §3.15, `type MissingField`.
export const MISSING_FIELDS = [
  "TITLE",
  "DESCRIPTION",
  "TYPE",
  "CATEGORY",
  "AFFECTED_SCOPE",
  "WORK_IMPACT",
  "COMMITMENT_RISK",
  "TARGET_TICKET",
  "ADDITIONAL_INFORMATION",
  "REOPEN_REASON",
] as const;

// DM v2.13 §3.4: `ImpactAssessmentDraft = Partial<ImpactAssessment>` (em construção).
export const impactAssessmentDraftSchema = z.strictObject({
  affectedScope: z.enum(AFFECTED_SCOPES).optional(),
  workImpact: z.enum(WORK_IMPACTS).optional(),
  commitmentRisk: z.enum(COMMITMENT_RISKS).optional(),
});

// Esquemas estritos (CRITERIA.md, "Representação"): o contrato do DM é fechado. Campo
// extra, `null` no lugar de ausente ou valor fora do catálogo tornam a saída inválida.
export const interpretationSchema = z.strictObject({
  intent: z.enum(INTENTS),
  confidence: z.enum(CONFIDENCES),
  entities: z.strictObject({
    problem: z.string().optional(),
    category: z.enum(TICKET_CATEGORIES).optional(),
    operatingSystem: z.string().optional(),
    impact: impactAssessmentDraftSchema.optional(),
  }),
  missingFields: z.array(z.enum(MISSING_FIELDS)),
});

export type Interpretation = z.infer<typeof interpretationSchema>;
