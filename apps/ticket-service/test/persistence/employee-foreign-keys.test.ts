import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Ticket, TicketEvent } from "../../src/domain/index.js";
import { createUnitOfWork } from "../../src/persistence/unit-of-work.js";
import { createTestDatabase } from "../support/test-database.js";

// ADR-008, atualização de 2026-11-21: FKs para Employee em Ticket.requesterId (obrigatória),
// Ticket.assignedTo (opcional) e TicketEvent.actorEmployeeId (opcional). Referência
// inexistente é recusada (P2003); null é aceito nas opcionais.

const FUNCIONARIO_INEXISTENTE = "EMP-404";

function chamado(overrides: Partial<Ticket> = {}): Ticket {
    return {
        id: "INC-FK-001",
        version: 1,
        type: "INC",
        title: "Notebook lento",
        description: "Notebook apresenta lentidão após atualização.",
        category: "HARDWARE",
        priority: "MEDIUM",
        status: "WAITING_ANALYST",
        requesterId: "EMP-001",
        impactAssessment: {
            workImpact: "NONE",
            affectedScope: "SELF",
            commitmentRisk: "NO",
        },
        createdAt: "2026-11-06T10:00:00.000Z",
        updatedAt: "2026-11-06T10:00:00.000Z",
        firstResponseDueAt: "2026-11-09T10:00:00.000Z",
        ...overrides,
    };
}

function evento(overrides: Partial<TicketEvent> = {}): TicketEvent {
    return {
        id: "EVT-FK-001",
        ticketId: "INC-FK-001",
        type: "CREATED",
        actor: { type: "EMPLOYEE", employeeId: "EMP-001" },
        summary: "Chamado criado",
        changes: [],
        occurredAt: "2026-11-06T10:00:00.000Z",
        ...overrides,
    };
}

describe("FKs para Employee", () => {
    let db: Awaited<ReturnType<typeof createTestDatabase>>;
    let unitOfWork: ReturnType<typeof createUnitOfWork>;

    beforeAll(async () => {
        db = await createTestDatabase();
        unitOfWork = createUnitOfWork(db.prisma);
    });

    beforeEach(async () => {
        await db.reset();
    });

    afterAll(async () => {
        await db.dispose();
    });

    function criarChamado(ticket: Ticket) {
        return unitOfWork.execute(({ tickets }) => tickets.create(ticket));
    }

    it("Ticket.requesterId inexistente é recusado (P2003)", async () => {
        await expect(criarChamado(chamado({ requesterId: FUNCIONARIO_INEXISTENTE }))).rejects.toMatchObject({
            code: "P2003",
        });
        expect(await db.prisma.ticket.count()).toBe(0);
    });

    it("Ticket.assignedTo inexistente é recusado (P2003)", async () => {
        await db.createEmployees("EMP-001");

        await expect(criarChamado(chamado({ assignedTo: FUNCIONARIO_INEXISTENTE }))).rejects.toMatchObject({
            code: "P2003",
        });
        expect(await db.prisma.ticket.count()).toBe(0);
    });

    it("Ticket sem assignedTo (null na coluna) é aceito", async () => {
        await db.createEmployees("EMP-001");

        await criarChamado(chamado());

        const linha = await db.prisma.ticket.findUniqueOrThrow({ where: { id: "INC-FK-001" } });
        expect(linha.assignedTo).toBeNull();
    });

    it("TicketEvent.actorEmployeeId inexistente é recusado (P2003)", async () => {
        await db.createEmployees("EMP-001");
        await criarChamado(chamado());

        await expect(
            unitOfWork.execute(({ ticketEvents }) =>
                ticketEvents.create(evento({ actor: { type: "ANALYST", employeeId: FUNCIONARIO_INEXISTENTE } })),
            ),
        ).rejects.toMatchObject({ code: "P2003" });
        expect(await db.prisma.ticketEvent.count()).toBe(0);
    });

    it("TicketEvent com ator SYSTEM (actorEmployeeId null) é aceito", async () => {
        await db.createEmployees("EMP-001");
        await criarChamado(chamado());

        await unitOfWork.execute(({ ticketEvents }) => ticketEvents.create(evento({ actor: { type: "SYSTEM" } })));

        const linha = await db.prisma.ticketEvent.findUniqueOrThrow({ where: { id: "EVT-FK-001" } });
        expect(linha.actorEmployeeId).toBeNull();
    });
});
