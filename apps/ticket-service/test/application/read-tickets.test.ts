import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createListMyTickets } from "../../src/application/list-my-tickets.js";
import { createViewMyTicket } from "../../src/application/view-my-ticket.js";
import type { Ticket } from "../../src/domain/index.js";
import { createUnitOfWork } from "../../src/persistence/unit-of-work.js";
import { createTestDatabase } from "../support/test-database.js";

// Casos de uso das leituras do funcionário (contrato §8, §9 e §12). Recebem o requesterId já
// verificado pela camada HTTP; calculam currentDueAt e o vencido com o relógio injetado
// (DM §3.2, §8.5.2).

const NOW = "2026-11-20T15:00:00.000Z";

function chamado(overrides: Partial<Ticket> & Pick<Ticket, "id">): Ticket {
    return {
        version: 1,
        type: "INC",
        title: `Chamado ${overrides.id}`,
        description: "Descrição do chamado.",
        category: "HARDWARE",
        priority: "LOW",
        status: "WAITING_ANALYST",
        requesterId: "EMP-001",
        impactAssessment: { workImpact: "NONE", affectedScope: "SELF", commitmentRisk: "NO" },
        createdAt: "2026-11-15T12:00:00.000Z",
        updatedAt: "2026-11-15T12:00:00.000Z",
        firstResponseDueAt: "2026-11-25T12:00:00.000Z",
        ...overrides,
    };
}

const VENCIDO = chamado({
    id: "INC-1",
    updatedAt: "2026-11-18T12:00:00.000Z",
    firstResponseDueAt: "2026-11-19T12:00:00.000Z",
});
const RESOLVIDO = chamado({
    id: "INC-2",
    status: "RESOLVED",
    resolvedAt: "2026-11-15T12:00:00.000Z",
    firstResponseDueAt: "2026-11-19T12:00:00.000Z",
});
const DE_OUTRO = chamado({ id: "INC-9", requesterId: "EMP-002" });

describe("casos de uso das leituras", () => {
    let db: Awaited<ReturnType<typeof createTestDatabase>>;
    let unitOfWork: ReturnType<typeof createUnitOfWork>;
    let chamadasDoRelogio: number;
    const clock = {
        now: () => {
            chamadasDoRelogio += 1;
            return NOW;
        },
    };

    beforeAll(async () => {
        db = await createTestDatabase();
        unitOfWork = createUnitOfWork(db.prisma);
        await db.reset();
        await db.createEmployees("EMP-001", "EMP-002");
        await unitOfWork.execute(async ({ tickets }) => {
            for (const ticket of [VENCIDO, RESOLVIDO, DE_OUTRO]) {
                await tickets.create(ticket);
            }
        });
    });

    afterAll(async () => {
        await db.dispose();
    });

    describe("listMyTickets", () => {
        it("devolve só os chamados do solicitante, com prazo vigente e vencido calculados", async () => {
            chamadasDoRelogio = 0;
            const listMyTickets = createListMyTickets({ unitOfWork, clock });

            const views = await listMyTickets.execute({ requesterId: "EMP-001" });

            expect(views).toStrictEqual([
                { ticket: VENCIDO, currentDueAt: "2026-11-19T12:00:00.000Z", isOverdue: true },
                { ticket: RESOLVIDO, currentDueAt: "2026-11-19T12:00:00.000Z", isOverdue: null },
            ]);
            expect(chamadasDoRelogio).toBe(1);
        });

        it("solicitante sem chamados: lista vazia", async () => {
            const listMyTickets = createListMyTickets({ unitOfWork, clock });

            expect(await listMyTickets.execute({ requesterId: "EMP-404" })).toStrictEqual([]);
        });
    });

    describe("viewMyTicket", () => {
        it("devolve o chamado do solicitante, com prazo vigente e vencido", async () => {
            const viewMyTicket = createViewMyTicket({ unitOfWork, clock });

            expect(await viewMyTicket.execute({ requesterId: "EMP-001", ticketId: "INC-2" })).toStrictEqual({
                ok: true,
                view: { ticket: RESOLVIDO, currentDueAt: "2026-11-19T12:00:00.000Z", isOverdue: null },
            });
        });

        it.each([
            ["inexistente", "INC-999999"],
            ["de outro funcionário", "INC-9"],
            ["malformado", "abc"],
        ])("chamado %s: TICKET_NOT_FOUND", async (_nome, ticketId) => {
            const viewMyTicket = createViewMyTicket({ unitOfWork, clock });

            expect(await viewMyTicket.execute({ requesterId: "EMP-001", ticketId })).toStrictEqual({
                ok: false,
                error: "TICKET_NOT_FOUND",
            });
        });
    });
});
