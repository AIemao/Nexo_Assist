
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Ticket, TicketInvariantError } from "../../src/domain/index.js";
import { TicketInvariantViolation } from "../../src/persistence/ticket-invariant-violation.js";
import { createTicketRepository } from "../../src/persistence/ticket-repository.js";
import { createTestDatabase } from "../support/test-database.js";

async function esperarViolacaoDeInvariante(
    operacao: Promise<unknown>,
    errosEsperados: TicketInvariantError[],
): Promise<void> {
    const resultado = await operacao.then(
        () => ({ rejeitada: false as const }),
        (erro: unknown) => ({ rejeitada: true as const, erro }),
    );

    expect(resultado.rejeitada).toBe(true);

    if (!resultado.rejeitada) return;

    expect(resultado.erro).toBeInstanceOf(TicketInvariantViolation);

    if (!(resultado.erro instanceof TicketInvariantViolation)) return;

    expect(resultado.erro.errors).toStrictEqual(errosEsperados);
}

describe("TicketRepository", () => {
    let db: Awaited<ReturnType<typeof createTestDatabase>>;
    let repository: ReturnType<typeof createTicketRepository>;

    const chamadoValido = (overrides: Partial<Ticket> = {}): Ticket => ({
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
        ...overrides,
    });

    beforeAll(async () => {
        db = await createTestDatabase();
        repository = createTicketRepository(db.prisma);
    });

    beforeEach(async () => {
        await db.prisma.ticket.deleteMany();
    });

    afterAll(async () => {
        await db.dispose();
    });

    it("cria e recupera um chamado mantendo sua representação de domínio", async () => {
        const chamado = chamadoValido();

        const criado = await repository.create(chamado);

        expect(criado).toStrictEqual(chamado);

        const encontrado = await repository.findById(chamado.id);

        expect(encontrado).toStrictEqual(chamado);
    });

    it("normaliza as datas obrigatórias e opcionais para UTC sem alterar o instante", async () => {
        const chamado = chamadoValido({
            status: "RESOLVED",
            assignedTo: "EMP-002",
            createdAt: "2026-11-06T10:00:00.000-03:00",
            updatedAt: "2026-11-06T10:30:00.000-03:00",
            resolvedAt: "2026-11-06T14:00:00.000-03:00",
            firstResponseDueAt: "2026-11-06T14:00:00.000-03:00",
            nextUpdateDueAt: "2026-11-06T13:00:00.000-03:00",
            serviceDeskUpdatedAt: "2026-11-06T12:00:00.000-03:00",
        });

        const chamadoNormalizado: Ticket = {
            ...chamado,
            createdAt: "2026-11-06T13:00:00.000Z",
            updatedAt: "2026-11-06T13:30:00.000Z",
            resolvedAt: "2026-11-06T17:00:00.000Z",
            firstResponseDueAt: "2026-11-06T17:00:00.000Z",
            nextUpdateDueAt: "2026-11-06T16:00:00.000Z",
            serviceDeskUpdatedAt: "2026-11-06T15:00:00.000Z",
        };

        const criado = await repository.create(chamado);

        expect(criado).toStrictEqual(chamadoNormalizado);

        const encontrado = await repository.findById(chamado.id);

        expect(encontrado).toStrictEqual(chamadoNormalizado);
    });

    it("retorna undefined quando o chamado não existe", async () => {
        const encontrado = await repository.findById("INC-DOES-NOT-EXIST");

        expect(encontrado).toBeUndefined();
    });

    it("rejeita a criação de chamado inválido sem persistir o registro", async () => {
        const chamado = chamadoValido({
            nextUpdateDueAt: "2026-11-06T15:00:00.000Z",
        });

        await esperarViolacaoDeInvariante(
            repository.create(chamado),
            ["UPDATE_DEADLINE_PAIR"],
        );

        const persistido = await db.prisma.ticket.findUnique({
            where: { id: chamado.id },
        });

        expect(persistido).toBeNull();
    });

    it("atualiza o chamado e incrementa sua versão", async () => {
        const chamado = chamadoValido();

        await repository.create(chamado);

        const chamadoAtualizado: Ticket = {
            ...chamado,
            version: 2,
            title: "Notebook lento após atualização",
        };

        const resultado = await repository.update({
            ...chamado,
            title: "Notebook lento após atualização",
        });

        expect(resultado).toStrictEqual({
            ok: true,
            ticket: chamadoAtualizado,
        });

        const encontrado = await repository.findById(chamado.id);

        expect(encontrado).toStrictEqual(chamadoAtualizado);
    });

    it("retorna VERSION_CONFLICT ao receber uma versão desatualizada", async () => {
        const chamado = chamadoValido();

        await repository.create(chamado);

        const chamadoAposPrimeiraAtualizacao: Ticket = {
            ...chamado,
            version: 2,
            title: "Primeira atualização",
        };

        const primeiroResultado = await repository.update({
            ...chamado,
            title: "Primeira atualização",
        });

        expect(primeiroResultado).toStrictEqual({
            ok: true,
            ticket: chamadoAposPrimeiraAtualizacao,
        });

        const resultadoDesatualizado = await repository.update({
            ...chamado,
            title: "Atualização com versão antiga",
        });

        expect(resultadoDesatualizado).toStrictEqual({
            ok: false,
            error: "VERSION_CONFLICT",
        });

        const encontrado = await repository.findById(chamado.id);

        expect(encontrado).toStrictEqual(chamadoAposPrimeiraAtualizacao);
    });

    it("retorna NOT_FOUND ao atualizar um chamado inexistente", async () => {
        const chamado = chamadoValido();

        const resultado = await repository.update(chamado);

        expect(resultado).toStrictEqual({
            ok: false,
            error: "NOT_FOUND",
        });
    });

    it("rejeita atualização inválida sem alterar o registro persistido", async () => {
        const chamado = chamadoValido();

        await repository.create(chamado);

        const chamadoInvalido: Ticket = {
            ...chamado,
            title: "Atualização inválida",
            nextUpdateDueAt: "2026-11-06T15:00:00.000Z",
        };

        await esperarViolacaoDeInvariante(
            repository.update(chamadoInvalido),
            ["UPDATE_DEADLINE_PAIR"],
        );

        const encontrado = await repository.findById(chamado.id);

        expect(encontrado).toStrictEqual(chamado);
    });
});
