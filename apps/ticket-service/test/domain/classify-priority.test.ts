import { describe, expect, it } from "vitest";

import { classifyPriority } from "../../src/domain/classify-priority.js";

import type {
    ImpactAssessmentDraft,
    PriorityClassification,
} from "../../src/domain/index.js";

type Case = [
    nome: string,
    entrada: ImpactAssessmentDraft,
    esperado: PriorityClassification,
];

const casos: Case[] = [
    // Regra 0 — workImpact ausente
    [
        "R0: nada informado pede o impacto",
        {},
        {
            status: "NEEDS_CLARIFICATION",
            missingFields: ["WORK_IMPACT"],
            reasonCode: "WORK_IMPACT_MISSING",
        },
    ],
    [
        "R0 vence: alcance informado não importa sem o impacto",
        { affectedScope: "TEAM" },
        {
            status: "NEEDS_CLARIFICATION",
            missingFields: ["WORK_IMPACT"],
            reasonCode: "WORK_IMPACT_MISSING",
        },
    ],

    // Regra 1 — BLOCKED sem alcance
    [
        "R1: BLOCKED sem alcance pede somente AFFECTED_SCOPE",
        { workImpact: "BLOCKED" },
        {
            status: "NEEDS_CLARIFICATION",
            missingFields: ["AFFECTED_SCOPE"],
            reasonCode: "AFFECTED_SCOPE_MISSING",
        },
    ],

    // Regra 2 — BLOCKED + TEAM ou COMPANY
    [
        "R2: BLOCKED + TEAM resulta em CRITICAL",
        { workImpact: "BLOCKED", affectedScope: "TEAM" },
        {
            status: "CLASSIFIED",
            priority: "CRITICAL",
            reasonCode: "TEAM_OR_COMPANY_BLOCKED",
        },
    ],
    [
        "R2: BLOCKED + COMPANY resulta em CRITICAL",
        { workImpact: "BLOCKED", affectedScope: "COMPANY" },
        {
            status: "CLASSIFIED",
            priority: "CRITICAL",
            reasonCode: "TEAM_OR_COMPANY_BLOCKED",
        },
    ],
    [
        "R2 vence R6: BLOCKED + TEAM + YES continua CRITICAL",
        {
            workImpact: "BLOCKED",
            affectedScope: "TEAM",
            commitmentRisk: "YES",
        },
        {
            status: "CLASSIFIED",
            priority: "CRITICAL",
            reasonCode: "TEAM_OR_COMPANY_BLOCKED",
        },
    ],

    // Regra 3 — BLOCKED + SELF
    [
        "R3: BLOCKED + SELF resulta em HIGH",
        { workImpact: "BLOCKED", affectedScope: "SELF" },
        {
            status: "CLASSIFIED",
            priority: "HIGH",
            reasonCode: "SELF_BLOCKED",
        },
    ],
    [
        "R3 vence R6: BLOCKED + SELF + YES continua SELF_BLOCKED",
        {
            workImpact: "BLOCKED",
            affectedScope: "SELF",
            commitmentRisk: "YES",
        },
        {
            status: "CLASSIFIED",
            priority: "HIGH",
            reasonCode: "SELF_BLOCKED",
        },
    ],

    // Regra 4 — BLOCKED + UNKNOWN
    [
        "R4: BLOCKED + UNKNOWN resulta em HIGH sem perguntar commitmentRisk",
        { workImpact: "BLOCKED", affectedScope: "UNKNOWN" },
        {
            status: "CLASSIFIED",
            priority: "HIGH",
            reasonCode: "AFFECTED_SCOPE_UNKNOWN",
        },
    ],

    // Regra 5 — commitmentRisk ausente (fora de BLOCKED)
    [
        "R5: DEGRADED_WITH_WORKAROUND sem commitmentRisk pede o risco",
        { workImpact: "DEGRADED_WITH_WORKAROUND" },
        {
            status: "NEEDS_CLARIFICATION",
            missingFields: ["COMMITMENT_RISK"],
            reasonCode: "COMMITMENT_RISK_MISSING",
        },
    ],
    [
        "R5: NONE sem commitmentRisk pede o risco",
        { workImpact: "NONE" },
        {
            status: "NEEDS_CLARIFICATION",
            missingFields: ["COMMITMENT_RISK"],
            reasonCode: "COMMITMENT_RISK_MISSING",
        },
    ],

    // Regra 6 — commitmentRisk YES
    [
        "R6: DEGRADED_WITH_WORKAROUND + YES resulta em HIGH",
        {
            workImpact: "DEGRADED_WITH_WORKAROUND",
            commitmentRisk: "YES",
        },
        {
            status: "CLASSIFIED",
            priority: "HIGH",
            reasonCode: "COMMITMENT_AT_RISK_TODAY",
        },
    ],
    [
        "R6: NONE + YES resulta em HIGH",
        { workImpact: "NONE", commitmentRisk: "YES" },
        {
            status: "CLASSIFIED",
            priority: "HIGH",
            reasonCode: "COMMITMENT_AT_RISK_TODAY",
        },
    ],

    // Regra 7 — DEGRADED_WITH_WORKAROUND
    [
        "R7: DEGRADED_WITH_WORKAROUND + NO resulta em MEDIUM",
        {
            workImpact: "DEGRADED_WITH_WORKAROUND",
            commitmentRisk: "NO",
        },
        {
            status: "CLASSIFIED",
            priority: "MEDIUM",
            reasonCode: "WORKAROUND_AVAILABLE",
        },
    ],
    [
        "R7: DEGRADED_WITH_WORKAROUND + UNKNOWN não eleva a prioridade",
        {
            workImpact: "DEGRADED_WITH_WORKAROUND",
            commitmentRisk: "UNKNOWN",
        },
        {
            status: "CLASSIFIED",
            priority: "MEDIUM",
            reasonCode: "WORKAROUND_AVAILABLE",
        },
    ],
    [
        "R7: alcance COMPANY não altera prioridade fora de BLOCKED",
        {
            workImpact: "DEGRADED_WITH_WORKAROUND",
            affectedScope: "COMPANY",
            commitmentRisk: "NO",
        },
        {
            status: "CLASSIFIED",
            priority: "MEDIUM",
            reasonCode: "WORKAROUND_AVAILABLE",
        },
    ],

    // Regra 8 — NONE
    [
        "R8: NONE + NO resulta em LOW",
        { workImpact: "NONE", commitmentRisk: "NO" },
        {
            status: "CLASSIFIED",
            priority: "LOW",
            reasonCode: "NO_WORK_IMPACT",
        },
    ],
    [
        "R8: NONE + UNKNOWN resulta em LOW",
        { workImpact: "NONE", commitmentRisk: "UNKNOWN" },
        {
            status: "CLASSIFIED",
            priority: "LOW",
            reasonCode: "NO_WORK_IMPACT",
        },
    ],

    // Decisão do Bloco 2 — classificar não é validar
    [
        "DEGRADED_WITH_WORKAROUND + NOT_ASKED classifica como MEDIUM",
        {
            workImpact: "DEGRADED_WITH_WORKAROUND",
            commitmentRisk: "NOT_ASKED",
        },
        {
            status: "CLASSIFIED",
            priority: "MEDIUM",
            reasonCode: "WORKAROUND_AVAILABLE",
        },
    ],
];

describe("classifyPriority", () => {
    it.each(casos)("%s", (_nome, entrada, esperado) => {
        expect(classifyPriority(entrada)).toEqual(esperado);
    });
});