
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
} from "vitest";
import { createUnitOfWork } from "../../src/persistence/unit-of-work.js";
import { createTestDatabase } from "../support/test-database.js";

describe("TicketIdAllocator", () => {
    let db: Awaited<ReturnType<typeof createTestDatabase>>;

    beforeAll(async () => {
        db = await createTestDatabase();
    });

    beforeEach(async () => {
        await db.prisma.ticketCounter.deleteMany();
    });

    afterAll(async () => {
        await db.dispose();
    });

    it("começa em 1 e incrementa a cada alocação", async () => {
        const unitOfWork = createUnitOfWork(db.prisma);

        const numeros = await unitOfWork.execute(async ({ ticketIdAllocator }) => {
            const primeiro = await ticketIdAllocator.allocateNext("INC");
            const segundo = await ticketIdAllocator.allocateNext("INC");

            return [primeiro, segundo];
        });

        expect(numeros).toStrictEqual([1, 2]);
    });

    it("mantém contadores independentes para INC e REQ", async () => {
        const unitOfWork = createUnitOfWork(db.prisma);

        const numeros = await unitOfWork.execute(async ({ ticketIdAllocator }) => {
            const primeiroInc = await ticketIdAllocator.allocateNext("INC");
            const segundoInc = await ticketIdAllocator.allocateNext("INC");
            const primeiroReq = await ticketIdAllocator.allocateNext("REQ");

            return [primeiroInc, segundoInc, primeiroReq];
        });

        expect(numeros).toStrictEqual([1, 2, 1]);
    });

    it("preserva a numeração entre transações", async () => {
        const unitOfWork = createUnitOfWork(db.prisma);

        const primeiraAlocacao = await unitOfWork.execute(
            async ({ ticketIdAllocator }) => {
                return ticketIdAllocator.allocateNext("INC");
            },
        );

        const segundaAlocacao = await unitOfWork.execute(
            async ({ ticketIdAllocator }) => {
                return ticketIdAllocator.allocateNext("INC");
            },
        );

        expect([primeiraAlocacao, segundaAlocacao]).toStrictEqual([1, 2]);
    });

    it("não consome o número quando a transação sofre rollback", async () => {
        const unitOfWork = createUnitOfWork(db.prisma);
        const falha = new Error("falha simulada");

        await expect(
            unitOfWork.execute(async ({ ticketIdAllocator }) => {
                const numero = await ticketIdAllocator.allocateNext("INC");

                expect(numero).toBe(1);

                throw falha;
            }),
        ).rejects.toBe(falha);

        const proximaAlocacao = await unitOfWork.execute(
            async ({ ticketIdAllocator }) => {
                return ticketIdAllocator.allocateNext("INC");
            },
        );

        expect(proximaAlocacao).toBe(1);
    });
});
