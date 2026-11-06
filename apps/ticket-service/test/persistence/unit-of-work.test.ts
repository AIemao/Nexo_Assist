
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
} from "vitest";
import type { Ticket } from "../../src/domain/index.js";
import { createTicketRepository } from "../../src/persistence/ticket-repository.js";
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

describe("Unit of Work", () => {
    let db: Awaited<ReturnType<typeof createTestDatabase>>;

    beforeAll(async () => {
        db = await createTestDatabase();
    });

    beforeEach(async () => {
        await db.prisma.ticket.deleteMany();
    });

    afterAll(async () => {
        await db.dispose();
    });

    // Teste 1: mata uma implementação de execute que nunca confirma a transação.
    it("cria e recupera o chamado após a transação", async () => {
        const unitOfWork = createUnitOfWork(db.prisma);

        const chamadoCriado = await unitOfWork.execute(async ({ tickets }) => {
            return tickets.create(chamadoValido);
        });

        const ticketRepository = createTicketRepository(db.prisma);
        const chamadoPersistido = await ticketRepository.findById(chamadoValido.id);

        expect(chamadoCriado).toStrictEqual(chamadoValido);
        expect(chamadoPersistido).toStrictEqual(chamadoValido);
    });

    // Teste 2: prova que a criação é desfeita quando a transação falha.
    it("desfaz a criação quando a transação falha", async () => {
        const unitOfWork = createUnitOfWork(db.prisma);
        const falha = new Error("falha simulada");

        await expect(
            unitOfWork.execute(async ({ tickets }) => {
                await tickets.create(chamadoValido);
                throw falha;
            }),
        ).rejects.toBe(falha);

        const ticketRepository = createTicketRepository(db.prisma);
        const chamadoPersistido = await ticketRepository.findById(chamadoValido.id);

        expect(chamadoPersistido).toBeUndefined();
    });

    // Teste 3: prova que a atualização é desfeita quando a transação falha.
    it("desfaz a atualização quando a transação falha", async () => {
        const ticketRepository = createTicketRepository(db.prisma);
        await ticketRepository.create(chamadoValido);

        const unitOfWork = createUnitOfWork(db.prisma);
        const falha = new Error("falha simulada");

        await expect(
            unitOfWork.execute(async ({ tickets }) => {
                const resultado = await tickets.update({
                    ...chamadoValido,
                    title: "Notebook lento após atualização",
                    updatedAt: "2026-11-06T10:30:00.000Z",
                });

                expect(resultado).toStrictEqual({
                    ok: true,
                    ticket: {
                        ...chamadoValido,
                        version: 2,
                        title: "Notebook lento após atualização",
                        updatedAt: "2026-11-06T10:30:00.000Z",
                    },
                });

                throw falha;
            }),
        ).rejects.toBe(falha);

        const chamadoPersistido = await ticketRepository.findById(chamadoValido.id);

        expect(chamadoPersistido).toStrictEqual(chamadoValido);
    });

    // Teste 4: mata um tratamento de P2025 que impede continuar usando a transação.
    it("continua consultável após um conflito de versão na transação", async () => {
        const ticketRepository = createTicketRepository(db.prisma);
        await ticketRepository.create(chamadoValido);

        const atualizacao = await ticketRepository.update({
            ...chamadoValido,
            title: "Notebook lento após atualização",
            updatedAt: "2026-11-06T10:30:00.000Z",
        });

        expect(atualizacao).toStrictEqual({
            ok: true,
            ticket: {
                ...chamadoValido,
                version: 2,
                title: "Notebook lento após atualização",
                updatedAt: "2026-11-06T10:30:00.000Z",
            },
        });

        const unitOfWork = createUnitOfWork(db.prisma);

        const resultado = await unitOfWork.execute(async ({ tickets }) => {
            const conflito = await tickets.update(chamadoValido);
            const chamadoEncontrado = await tickets.findById(chamadoValido.id);

            return { conflito, chamadoEncontrado };
        });

        expect(resultado.conflito).toStrictEqual({
            ok: false,
            error: "VERSION_CONFLICT",
        });

        expect(resultado.chamadoEncontrado).toStrictEqual({
            ...chamadoValido,
            version: 2,
            title: "Notebook lento após atualização",
            updatedAt: "2026-11-06T10:30:00.000Z",
        });
    });
});
