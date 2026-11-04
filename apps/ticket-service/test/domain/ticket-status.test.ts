import { describe, expect, it } from "vitest";

import { canReopen, isOpenTicket } from "../../src/domain/ticket-status.js";

import type { TicketStatus } from "../../src/domain/index.js";

describe("isOpenTicket", () => {
    const esperadoPorStatus = {
        WAITING_ANALYST: true,
        APPROVED: true,
        RESOLVED: false,
    } satisfies Record<TicketStatus, boolean>;

    it.each(Object.entries(esperadoPorStatus) as [TicketStatus, boolean][])(
        "%s → %s",
        (status, esperado) => {
            expect(isOpenTicket(status)).toBe(esperado);
        },
    );
});

describe("canReopen", () => {
    const resolvedAt = "2026-11-01T12:00:00.000Z";

    it("exatamente 7 dias depois ainda é elegível (limite incluído)", () => {
        expect(
            canReopen(
                { status: "RESOLVED", resolvedAt },
                "2026-11-08T12:00:00.000Z",
            ),
        ).toBe(true);
    });

    it("7 dias e 1 milissegundo depois não é elegível", () => {
        expect(
            canReopen(
                { status: "RESOLVED", resolvedAt },
                "2026-11-08T12:00:00.001Z",
            ),
        ).toBe(false);
    });

    it("no mesmo instante da resolução é elegível", () => {
        expect(
            canReopen(
                { status: "RESOLVED", resolvedAt },
                "2026-11-01T12:00:00.000Z",
            ),
        ).toBe(true);
    });

    it("1 dia depois da resolução é elegível", () => {
        expect(
            canReopen(
                { status: "RESOLVED", resolvedAt },
                "2026-11-02T12:00:00.000Z",
            ),
        ).toBe(true);
    });

    it("reconhece o mesmo instante com fuso de Brasília", () => {
        expect(
            canReopen(
                { status: "RESOLVED", resolvedAt },
                "2026-11-08T09:00:00.000-03:00",
            ),
        ).toBe(true);
    });

    it("RESOLVED sem resolvedAt não é elegível", () => {
        expect(
            canReopen(
                { status: "RESOLVED" },
                "2026-11-05T12:00:00.000Z",
            ),
        ).toBe(false);
    });

    it("WAITING_ANALYST não é elegível, mesmo com resolvedAt", () => {
        expect(
            canReopen(
                { status: "WAITING_ANALYST", resolvedAt },
                "2026-11-05T12:00:00.000Z",
            ),
        ).toBe(false);
    });

    it("APPROVED não é elegível, mesmo com resolvedAt", () => {
        expect(
            canReopen(
                { status: "APPROVED", resolvedAt },
                "2026-11-05T12:00:00.000Z",
            ),
        ).toBe(false);
    });

    it("resolvedAt inválido não é elegível", () => {
        expect(
            canReopen(
                { status: "RESOLVED", resolvedAt: "não é uma data" },
                "2026-11-05T12:00:00.000Z",
            ),
        ).toBe(false);
    });

    it("now inválido não é elegível", () => {
        expect(
            canReopen(
                { status: "RESOLVED", resolvedAt },
                "ontem",
            ),
        ).toBe(false);
    });
});