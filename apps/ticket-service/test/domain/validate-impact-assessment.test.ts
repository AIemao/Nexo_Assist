import { describe, expect, it } from "vitest";

import { classifyPriority } from "../../src/domain/classify-priority.js";
import { validateImpactAssessment } from "../../src/domain/validate-impact-assessment.js";

import type { ImpactAssessment } from "../../src/domain/index.js";

describe("validateImpactAssessment", () => {
    it("rejeita NOT_ASKED com DEGRADED_WITH_WORKAROUND", () => {
        const assessment: ImpactAssessment = {
            workImpact: "DEGRADED_WITH_WORKAROUND",
            affectedScope: "SELF",
            commitmentRisk: "NOT_ASKED",
        };
        expect(validateImpactAssessment(assessment)).toEqual({
            ok: false,
            error: "NOT_ASKED_REQUIRES_BLOCKED",
        });
    });

    it("rejeita NOT_ASKED com NONE", () => {
        const assessment: ImpactAssessment = {
            workImpact: "NONE",
            affectedScope: "SELF",
            commitmentRisk: "NOT_ASKED",
        };
        expect(validateImpactAssessment(assessment)).toEqual({
            ok: false,
            error: "NOT_ASKED_REQUIRES_BLOCKED",
        });
    });

    it("aceita NOT_ASKED com BLOCKED", () => {
        const assessment: ImpactAssessment = {
            workImpact: "BLOCKED",
            affectedScope: "SELF",
            commitmentRisk: "NOT_ASKED",
        };
        expect(validateImpactAssessment(assessment)).toEqual({ ok: true });
    });

    it("aceita BLOCKED com YES (não existe a regra inversa)", () => {
        const assessment: ImpactAssessment = {
            workImpact: "BLOCKED",
            affectedScope: "SELF",
            commitmentRisk: "YES",
        };
        expect(validateImpactAssessment(assessment)).toEqual({ ok: true });
    });

    it("aceita DEGRADED_WITH_WORKAROUND com NO", () => {
        const assessment: ImpactAssessment = {
            workImpact: "DEGRADED_WITH_WORKAROUND",
            affectedScope: "SELF",
            commitmentRisk: "NO",
        };
        expect(validateImpactAssessment(assessment)).toEqual({ ok: true });
    });
});

describe("classificar não é validar", () => {
    it("a mesma entrada é classificada por classifyPriority e rejeitada por validateImpactAssessment", () => {
        const entrada: ImpactAssessment = {
            workImpact: "DEGRADED_WITH_WORKAROUND",
            affectedScope: "SELF",
            commitmentRisk: "NOT_ASKED",
        };

        expect(classifyPriority(entrada)).toEqual({
            status: "CLASSIFIED",
            priority: "MEDIUM",
            reasonCode: "WORKAROUND_AVAILABLE",
        });
        expect(validateImpactAssessment(entrada)).toEqual({
            ok: false,
            error: "NOT_ASKED_REQUIRES_BLOCKED",
        });
    });
});
