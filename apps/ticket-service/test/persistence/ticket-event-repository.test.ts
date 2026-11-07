
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
} from "vitest";
import type { Ticket, TicketEvent } from "../../src/domain/index.js";
import { CorruptedRecordError } from "../../src/persistence/corrupted-record-error.js";
import { createUnitOfWork } from "../../src/persistence/unit-of-work.js";
import { createTestDatabase } from "../support/test-database.js";

const chamadoValido: Ticket = {
    id: "INC-TEST-001",
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
};

function criarEvento(overrides: Partial<TicketEvent> = {}): TicketEvent {
    return {
        id: "EVT-TEST-001",
        ticketId: chamadoValido.id,
        type: "CREATED",
        actor: {
            type: "EMPLOYEE",
            employeeId: "EMP-001",
        },
        summary: "Chamado criado",
        changes: [],
        occurredAt: "2026-11-06T10:00:00.000Z",
        ...overrides,
    };
}

describe("TicketEventRepository", () => {
    let db: Awaited<ReturnType<typeof createTestDatabase>>;
    let unitOfWork: ReturnType<typeof createUnitOfWork>;

    beforeAll(async () => {
        db = await createTestDatabase();
        unitOfWork = createUnitOfWork(db.prisma);
    });

    beforeEach(async () => {
        await db.reset();

        await unitOfWork.execute(async ({ tickets }) => {
            await tickets.create(chamadoValido);
        });
    });

    afterAll(async () => {
        await db.dispose();
    });

    it("persiste e recupera um evento com ator EMPLOYEE", async () => {
        const evento = criarEvento();

        await unitOfWork.execute(async ({ ticketEvents }) => {
            await ticketEvents.create(evento);
        });

        const eventos = await unitOfWork.execute(async ({ ticketEvents }) => {
            return ticketEvents.listByTicket(chamadoValido.id);
        });

        expect(eventos).toStrictEqual([evento]);
    });

    it("persiste e recupera um evento com ator SYSTEM sem employeeId", async () => {
        const evento = criarEvento({
            id: "EVT-SYSTEM-001",
            actor: {
                type: "SYSTEM",
            },
        });

        await unitOfWork.execute(async ({ ticketEvents }) => {
            await ticketEvents.create(evento);
        });

        const eventos = await unitOfWork.execute(async ({ ticketEvents }) => {
            return ticketEvents.listByTicket(chamadoValido.id);
        });

        expect(eventos).toStrictEqual([evento]);
    });

    it("preserva changes não vazio durante a persistência", async () => {
        const evento = criarEvento({
            id: "EVT-UPDATED-001",
            type: "UPDATED",
            summary: "Título atualizado",
            changes: [
                {
                    field: "title",
                    previousValue: "Notebook lento",
                    newValue: "Notebook lento após atualização",
                    metadata: {
                        source: "employee",
                        tags: ["manual", "confirmed"],
                    },
                },
            ],
        });

        await unitOfWork.execute(async ({ ticketEvents }) => {
            await ticketEvents.create(evento);
        });

        const eventos = await unitOfWork.execute(async ({ ticketEvents }) => {
            return ticketEvents.listByTicket(chamadoValido.id);
        });

        expect(eventos).toStrictEqual([evento]);
    });

    it("lança CorruptedRecordError ao ler ator EMPLOYEE sem employeeId", async () => {
        await db.prisma.ticketEvent.create({
            data: {
                id: "EVT-CORRUPTED-001",
                ticketId: chamadoValido.id,
                type: "CREATED",
                actorType: "EMPLOYEE",
                actorEmployeeId: null,
                summary: "Chamado criado",
                changes: [],
                occurredAt: new Date("2026-11-06T10:00:00.000Z"),
            },
        });

        await expect(
            unitOfWork.execute(async ({ ticketEvents }) => {
                return ticketEvents.listByTicket(chamadoValido.id);
            }),
        ).rejects.toBeInstanceOf(CorruptedRecordError);
    });

    it("rejeita a criação de evento para chamado inexistente", async () => {
        const evento = criarEvento({
            id: "EVT-MISSING-TICKET",
            ticketId: "INC-NONEXISTENT",
        });

        await expect(
            unitOfWork.execute(async ({ ticketEvents }) => {
                await ticketEvents.create(evento);
            }),
        ).rejects.toMatchObject({ code: "P2003" });
    });

    it("ordena por occurredAt e desempata por id em ordem crescente", async () => {
        const eventoMesmoInstanteIdMaior = criarEvento({
            id: "EVT-002",
            occurredAt: "2026-11-06T10:00:00.000Z",
        });

        const eventoPosterior = criarEvento({
            id: "EVT-000",
            type: "STATUS_CHANGED",
            occurredAt: "2026-11-06T11:00:00.000Z",
        });

        const eventoMesmoInstanteIdMenor = criarEvento({
            id: "EVT-001",
            type: "UPDATED",
            occurredAt: "2026-11-06T10:00:00.000Z",
        });

        const eventos = await unitOfWork.execute(async ({ ticketEvents }) => {
            await ticketEvents.create(eventoMesmoInstanteIdMaior);
            await ticketEvents.create(eventoPosterior);
            await ticketEvents.create(eventoMesmoInstanteIdMenor);

            return ticketEvents.listByTicket(chamadoValido.id);
        });

        expect(eventos.map(({ id }) => id)).toStrictEqual([
            "EVT-001",
            "EVT-002",
            "EVT-000",
        ]);
    });
});
