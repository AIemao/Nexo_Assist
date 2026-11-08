import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
} from "vitest";
import type { Ticket } from "../../src/domain/index.js";
import { createTicketEventRepository } from "../../src/persistence/ticket-event-repository.js";
import { createTicketRepository } from "../../src/persistence/ticket-repository.js";
import {
    createUnitOfWork,
    type UnitOfWork,
} from "../../src/persistence/unit-of-work.js";
import { TICKET_FIXTURES } from "../../src/seed/fixtures.js";
import {
    SeedFixtureStateError,
    seedFixtures,
} from "../../src/seed/seed-fixtures.js";
import { createTestDatabase } from "../support/test-database.js";

// Quarta-feira, 10:00 em UTC−03:00.
const REFERENCE = new Date("2026-11-04T13:00:00.000Z");
const REFERENCE_MAIS_3_DIAS = new Date("2026-11-07T13:00:00.000Z");

// Instantes da S1 (cenários §2.1) a partir da REFERENCE.
const CRIACAO_A1 = "2026-11-04T12:40:00.000Z";
const CRIACAO_B1 = "2026-11-04T12:50:00.000Z";
const CRIACAO_A2 = "2026-10-29T13:00:00.000Z";
const RESOLUCAO_A2 = "2026-10-31T13:00:00.000Z";

// Prazos de primeira resposta (DM §8.5.2: seg–sex, 08:00–18:00, UTC−03:00).
const PRAZO_A1 = "2026-11-09T12:40:00.000Z";
const PRAZO_B1 = "2026-11-11T12:50:00.000Z";
const PRAZO_A2 = "2026-11-03T13:00:00.000Z";

const ROTULOS = ["TKT-A1", "TKT-A2", "TKT-B1"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function criarGeradorDeEventos() {
    let n = 0;
    return {
        generate: () => `EVT-SEED-${++n}`,
    };
}

describe("seedFixtures", () => {
    let db: Awaited<ReturnType<typeof createTestDatabase>>;
    let unitOfWork: UnitOfWork;

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

    async function lerChamado(id: string): Promise<Ticket> {
        const ticket = await createTicketRepository(db.prisma).findById(id);
        if (ticket === undefined) {
            throw new Error(`Chamado ${id} não encontrado.`);
        }
        return ticket;
    }

    function lerEventos(ticketId: string) {
        return createTicketEventRepository(db.prisma).listByTicket(ticketId);
    }

    async function contagens() {
        return {
            chamados: await db.prisma.ticket.count(),
            eventos: await db.prisma.ticketEvent.count(),
            registros: await db.prisma.idempotencyRecord.count(),
        };
    }

    it("cria as fixtures com os dados do §2 e os instantes da S1", async () => {
        const mapa = await seedFixtures(
            { unitOfWork, eventIdGenerator: criarGeradorDeEventos() },
            REFERENCE,
        );

        expect(Object.keys(mapa).sort()).toStrictEqual(ROTULOS);
        expect(new Set(Object.values(mapa)).size).toBe(3);
        for (const id of Object.values(mapa)) {
            expect(id).toMatch(/^INC-[1-9][0-9]*$/);
        }

        const a1 = await lerChamado(mapa["TKT-A1"]);
        expect(a1).toMatchObject({
            version: 1,
            requesterId: "EMP-A",
            type: "INC",
            category: "HARDWARE",
            title: "Notebook lento",
            description: "O notebook está lento para abrir programas desde a última atualização.",
            status: "WAITING_ANALYST",
            priority: "MEDIUM",
            impactAssessment: {
                workImpact: "DEGRADED_WITH_WORKAROUND",
                affectedScope: "SELF",
                commitmentRisk: "NO",
            },
            createdAt: CRIACAO_A1,
            updatedAt: CRIACAO_A1,
            firstResponseDueAt: PRAZO_A1,
        });
        expect(a1).not.toHaveProperty("resolvedAt");

        const b1 = await lerChamado(mapa["TKT-B1"]);
        expect(b1).toMatchObject({
            version: 1,
            requesterId: "EMP-B",
            type: "INC",
            category: "HARDWARE",
            title: "Tecla solta no teclado reserva",
            description: "Uma tecla do teclado reserva está solta; uso o teclado principal normalmente.",
            status: "WAITING_ANALYST",
            priority: "LOW",
            impactAssessment: {
                workImpact: "NONE",
                affectedScope: "SELF",
                commitmentRisk: "NO",
            },
            createdAt: CRIACAO_B1,
            updatedAt: CRIACAO_B1,
            firstResponseDueAt: PRAZO_B1,
        });
        expect(b1).not.toHaveProperty("resolvedAt");

        const a2 = await lerChamado(mapa["TKT-A2"]);
        expect(a2).toMatchObject({
            version: 2,
            requesterId: "EMP-A",
            type: "INC",
            category: "ACCESS",
            title: "Senha do SAP não funciona",
            description: "A senha do SAP é recusada no login.",
            status: "RESOLVED",
            priority: "MEDIUM",
            impactAssessment: {
                workImpact: "DEGRADED_WITH_WORKAROUND",
                affectedScope: "SELF",
                commitmentRisk: "NO",
            },
            createdAt: CRIACAO_A2,
            updatedAt: RESOLUCAO_A2,
            resolvedAt: RESOLUCAO_A2,
            firstResponseDueAt: PRAZO_A2,
        });
        expect(a2).not.toHaveProperty("serviceDeskUpdatedAt");
        expect(a2).not.toHaveProperty("nextUpdateDueAt");
    });

    it("grava para o TKT-A2 um CREATED e um STATUS_CHANGED do ANALYST-1", async () => {
        const mapa = await seedFixtures(
            { unitOfWork, eventIdGenerator: criarGeradorDeEventos() },
            REFERENCE,
        );

        const eventos = await lerEventos(mapa["TKT-A2"]);

        expect(eventos).toHaveLength(2);
        expect(eventos[0]).toMatchObject({
            type: "CREATED",
            actor: { type: "EMPLOYEE", employeeId: "EMP-A" },
            summary: "Chamado criado",
            occurredAt: CRIACAO_A2,
            changes: [],
        });
        expect(eventos[1]).toMatchObject({
            type: "STATUS_CHANGED",
            actor: { type: "ANALYST", employeeId: "ANALYST-1" },
            summary: "Chamado resolvido",
            occurredAt: RESOLUCAO_A2,
            changes: [
                {
                    field: "status",
                    previousValue: "WAITING_ANALYST",
                    newValue: "RESOLVED",
                },
            ],
        });

        for (const rotulo of ["TKT-A1", "TKT-B1"] as const) {
            const eventosAbertos = await lerEventos(mapa[rotulo]);
            expect(eventosAbertos.map((evento) => evento.type)).toStrictEqual(["CREATED"]);
        }
    });

    it("não cria nada de novo na segunda execução com a mesma referência", async () => {
        const eventIdGenerator = criarGeradorDeEventos();
        const primeiroMapa = await seedFixtures({ unitOfWork, eventIdGenerator }, REFERENCE);
        const antes = await contagens();

        const segundoMapa = await seedFixtures({ unitOfWork, eventIdGenerator }, REFERENCE);

        expect(segundoMapa).toStrictEqual(primeiroMapa);
        expect(await contagens()).toStrictEqual(antes);
    });

    it("não reaplica a transição do TKT-A2 na segunda execução", async () => {
        const eventIdGenerator = criarGeradorDeEventos();
        const mapa = await seedFixtures({ unitOfWork, eventIdGenerator }, REFERENCE);
        const eventosAntes = await lerEventos(mapa["TKT-A2"]);

        await seedFixtures({ unitOfWork, eventIdGenerator }, REFERENCE);

        const a2 = await lerChamado(mapa["TKT-A2"]);
        expect(a2.version).toBe(2);
        expect(await lerEventos(mapa["TKT-A2"])).toStrictEqual(eventosAntes);
    });

    it("reexecução dias depois não grava nada nem renova as datas", async () => {
        const eventIdGenerator = criarGeradorDeEventos();
        const mapa = await seedFixtures({ unitOfWork, eventIdGenerator }, REFERENCE);
        const antes = await contagens();

        const segundoMapa = await seedFixtures({ unitOfWork, eventIdGenerator }, REFERENCE_MAIS_3_DIAS);

        expect(segundoMapa).toStrictEqual(mapa);
        expect(await contagens()).toStrictEqual(antes);

        expect(await lerChamado(mapa["TKT-A1"])).toMatchObject({
            createdAt: CRIACAO_A1,
            updatedAt: CRIACAO_A1,
        });
        expect(await lerChamado(mapa["TKT-B1"])).toMatchObject({
            createdAt: CRIACAO_B1,
            updatedAt: CRIACAO_B1,
        });
        expect(await lerChamado(mapa["TKT-A2"])).toMatchObject({
            version: 2,
            createdAt: CRIACAO_A2,
            updatedAt: RESOLUCAO_A2,
            resolvedAt: RESOLUCAO_A2,
        });
    });

    it("rejeita com SeedFixtureStateError quando o TKT-A2 está num status inesperado", async () => {
        const eventIdGenerator = criarGeradorDeEventos();
        const mapa = await seedFixtures({ unitOfWork, eventIdGenerator }, REFERENCE);

        // Único status que não é origem (WAITING_ANALYST) nem destino (RESOLVED).
        // APPROVED exige REQ (APPROVED_REQUIRES_REQ) e não admite resolvedAt (RESOLVED_AT_STATUS).
        await db.prisma.ticket.update({
            where: { id: mapa["TKT-A2"] },
            data: { status: "APPROVED", type: "REQ", resolvedAt: null },
        });
        const chamadoAntes = await lerChamado(mapa["TKT-A2"]);
        const eventosAntes = await lerEventos(mapa["TKT-A2"]);
        const antes = await contagens();

        const segundaExecucao = seedFixtures({ unitOfWork, eventIdGenerator }, REFERENCE);

        await expect(segundaExecucao).rejects.toBeInstanceOf(SeedFixtureStateError);
        await expect(segundaExecucao).rejects.toThrow(/TKT-A2/);
        await expect(segundaExecucao).rejects.toThrow(/APPROVED/);

        expect(await lerChamado(mapa["TKT-A2"])).toStrictEqual(chamadoAntes);
        expect(await lerEventos(mapa["TKT-A2"])).toStrictEqual(eventosAntes);
        expect(await contagens()).toStrictEqual(antes);
    });

    it("usa chaves de idempotência UUID, distintas, uma por rótulo", () => {
        const rotulos = TICKET_FIXTURES.map((fixture) => fixture.label);
        const chaves = TICKET_FIXTURES.map((fixture) => fixture.idempotencyKey);

        expect([...rotulos].sort()).toStrictEqual(ROTULOS);
        for (const chave of chaves) {
            expect(chave).toMatch(UUID);
        }
        expect(new Set(chaves).size).toBe(chaves.length);
    });
});
