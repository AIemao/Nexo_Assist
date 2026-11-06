
import { describe, expect, it } from "vitest";

import type { Ticket } from "../../src/domain/index.js";
import { validateTicketInvariants } from "../../src/domain/index.js";

function validTicket(overrides: Partial<Ticket> = {}): Ticket {
    return {
        id: "INC-20311",
        version: 1,
        type: "INC",
        title: "Notebook lento após atualização do Windows",
        description: "Notebook apresenta lentidão.",
        category: "HARDWARE",
        priority: "LOW",
        status: "WAITING_ANALYST",
        requesterId: "EMP-001",
        impactAssessment: {
            workImpact: "NONE",
            affectedScope: "SELF",
            commitmentRisk: "NO",
        },
        createdAt: "2026-11-02T10:00:00.000Z",
        updatedAt: "2026-11-02T10:00:00.000Z",
        firstResponseDueAt: "2026-11-02T18:00:00.000Z",
        ...overrides,
    };
}

describe("validateTicketInvariants", () => {
    it("aceita um ticket válido", () => {
        expect(validateTicketInvariants(validTicket())).toEqual({
            ok: true,
        });
    });

    describe("UPDATE_DEADLINE_PAIR", () => {
        it("rejeita nextUpdateDueAt sem serviceDeskUpdatedAt", () => {
            const ticket = validTicket({
                nextUpdateDueAt: "2026-11-03T18:00:00.000Z",
            });

            expect(validateTicketInvariants(ticket)).toEqual({
                ok: false,
                errors: ["UPDATE_DEADLINE_PAIR"],
            });
        });

        it("rejeita serviceDeskUpdatedAt sem nextUpdateDueAt", () => {
            const ticket = validTicket({
                serviceDeskUpdatedAt: "2026-11-03T10:00:00.000Z",
            });

            expect(validateTicketInvariants(ticket)).toEqual({
                ok: false,
                errors: ["UPDATE_DEADLINE_PAIR"],
            });
        });

        it("aceita os dois campos de atualização presentes", () => {
            const ticket = validTicket({
                nextUpdateDueAt: "2026-11-03T18:00:00.000Z",
                serviceDeskUpdatedAt: "2026-11-03T10:00:00.000Z",
            });

            expect(validateTicketInvariants(ticket)).toEqual({
                ok: true,
            });
        });
    });

    describe("RESOLVED_AT_STATUS", () => {
        it("rejeita RESOLVED sem resolvedAt", () => {
            const ticket = validTicket({
                status: "RESOLVED",
            });

            expect(validateTicketInvariants(ticket)).toEqual({
                ok: false,
                errors: ["RESOLVED_AT_STATUS"],
            });
        });

        it("rejeita resolvedAt quando status não é RESOLVED", () => {
            const ticket = validTicket({
                resolvedAt: "2026-11-02T15:00:00.000Z",
            });

            expect(validateTicketInvariants(ticket)).toEqual({
                ok: false,
                errors: ["RESOLVED_AT_STATUS"],
            });
        });

        it("aceita RESOLVED com resolvedAt", () => {
            const ticket = validTicket({
                status: "RESOLVED",
                resolvedAt: "2026-11-02T15:00:00.000Z",
            });

            expect(validateTicketInvariants(ticket)).toEqual({
                ok: true,
            });
        });
    });

    describe("APPROVED_REQUIRES_REQ", () => {
        it("rejeita APPROVED com tipo INC", () => {
            const ticket = validTicket({
                status: "APPROVED",
                type: "INC",
            });

            expect(validateTicketInvariants(ticket)).toEqual({
                ok: false,
                errors: ["APPROVED_REQUIRES_REQ"],
            });
        });

        it("aceita APPROVED com tipo REQ", () => {
            const ticket = validTicket({
                status: "APPROVED",
                type: "REQ",
            });

            expect(validateTicketInvariants(ticket)).toEqual({
                ok: true,
            });
        });

        it("aceita RESOLVED com tipo INC", () => {
            const ticket = validTicket({
                status: "RESOLVED",
                resolvedAt: "2026-11-02T15:00:00.000Z",
            });

            expect(validateTicketInvariants(ticket)).toEqual({
                ok: true,
            });
        });
    });

    describe("NOT_ASKED_REQUIRES_BLOCKED", () => {
        it("rejeita NOT_ASKED quando workImpact não é BLOCKED", () => {
            const ticket = validTicket({
                impactAssessment: {
                    workImpact: "NONE",
                    affectedScope: "SELF",
                    commitmentRisk: "NOT_ASKED",
                },
            });

            expect(validateTicketInvariants(ticket)).toEqual({
                ok: false,
                errors: ["NOT_ASKED_REQUIRES_BLOCKED"],
            });
        });

        it("aceita NOT_ASKED quando workImpact é BLOCKED", () => {
            const ticket = validTicket({
                impactAssessment: {
                    workImpact: "BLOCKED",
                    affectedScope: "SELF",
                    commitmentRisk: "NOT_ASKED",
                },
            });

            expect(validateTicketInvariants(ticket)).toEqual({
                ok: true,
            });
        });
    });

    it("retorna todas as violações na ordem definida", () => {
        const ticket = validTicket({
            nextUpdateDueAt: "2026-11-03T18:00:00.000Z",
            status: "APPROVED",
            resolvedAt: "2026-11-02T15:00:00.000Z",
            impactAssessment: {
                workImpact: "NONE",
                affectedScope: "SELF",
                commitmentRisk: "NOT_ASKED",
            },
        });

        expect(validateTicketInvariants(ticket)).toEqual({
            ok: false,
            errors: [
                "UPDATE_DEADLINE_PAIR",
                "RESOLVED_AT_STATUS",
                "APPROVED_REQUIRES_REQ",
                "NOT_ASKED_REQUIRES_BLOCKED",
            ],
        });
    });
});
