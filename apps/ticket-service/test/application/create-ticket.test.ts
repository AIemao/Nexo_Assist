
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
} from "vitest";
import { createCreateTicket } from "../../src/application/create-ticket.js";
import type {
    Actor,
    CreateTicketDraft,
    Ticket,
    TicketEvent,
} from "../../src/domain/index.js";
import { computeDueAt } from "../../src/domain/index.js";
import { createUnitOfWork } from "../../src/persistence/unit-of-work.js";
import { createTestDatabase } from "../support/test-database.js";

const NOW = "2026-11-07T12:00:00.000Z";

const IDEMPOTENCY_KEY_1 = "00000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY_2 = "00000000-0000-4000-8000-000000000002";
const IDEMPOTENCY_KEY_3 = "00000000-0000-4000-8000-000000000003";
const IDEMPOTENCY_KEY_4 = "00000000-0000-4000-8000-000000000004";
const IDEMPOTENCY_KEY_4_ANALYST = "00000000-0000-4000-8000-000000000041";
const IDEMPOTENCY_KEY_4_SYSTEM = "00000000-0000-4000-8000-000000000042";
const IDEMPOTENCY_KEY_5 = "00000000-0000-4000-8000-000000000005";
const IDEMPOTENCY_KEY_6 = "00000000-0000-4000-8000-000000000006";
const IDEMPOTENCY_KEY_7 = "00000000-0000-4000-8000-000000000007";
const IDEMPOTENCY_KEY_8 = "00000000-0000-4000-8000-000000000008";
const IDEMPOTENCY_KEY_8_RECOVERY = "00000000-0000-4000-8000-000000000081";
const IDEMPOTENCY_KEY_9 = "00000000-0000-4000-8000-000000000009";

const actor = {
    type: "EMPLOYEE",
    employeeId: "EMP-001",
} satisfies Actor;

const draft = {
    operation: "CREATE_TICKET",
    type: "INC",
    title: "Notebook lento",
    description: "Notebook apresenta lentidão após atualização.",
    category: "HARDWARE",
    priority: "LOW",
    impactAssessment: {
        workImpact: "NONE",
        affectedScope: "SELF",
        commitmentRisk: "NO",
    },
    firstResponseDueAt: "1900-01-01T00:00:00.000Z",
} satisfies CreateTicketDraft;

const draftPrioridadeHigh = {
    ...draft,
    priority: "HIGH",
} satisfies CreateTicketDraft;

const draftPrioridadeMedium = {
    ...draft,
    priority: "MEDIUM",
} satisfies CreateTicketDraft;

const draftImpactoInvalido = {
    ...draft,
    impactAssessment: {
        workImpact: "NONE",
        affectedScope: "SELF",
        commitmentRisk: "NOT_ASKED",
    },
} satisfies CreateTicketDraft;

const actorAnalyst = {
    type: "ANALYST",
    employeeId: "ANL-001",
} satisfies Actor;

const actorSystem = {
    type: "SYSTEM",
} satisfies Actor;

const outroFuncionario = {
    type: "EMPLOYEE",
    employeeId: "EMP-002",
} satisfies Actor;

const chamadoAncora: Ticket = {
    id: "INC-ANCORA-001",
    version: 1,
    type: "INC",
    title: "Chamado âncora",
    description: "Chamado que já possui o evento EVT-TEST-001.",
    category: "HARDWARE",
    priority: "LOW",
    status: "WAITING_ANALYST",
    requesterId: "EMP-001",
    impactAssessment: {
        workImpact: "NONE",
        affectedScope: "SELF",
        commitmentRisk: "NO",
    },
    createdAt: "2026-11-06T10:00:00.000Z",
    updatedAt: "2026-11-06T10:00:00.000Z",
    firstResponseDueAt: "2026-11-11T10:00:00.000Z",
};

const eventoConflitante: TicketEvent = {
    id: "EVT-TEST-001",
    ticketId: chamadoAncora.id,
    type: "CREATED",
    actor,
    summary: "Chamado criado",
    changes: [],
    occurredAt: "2026-11-06T10:00:00.000Z",
};

describe("createTicket", () => {
    let db: Awaited<ReturnType<typeof createTestDatabase>>;
    let unitOfWork: ReturnType<typeof createUnitOfWork>;
    let createTicket: ReturnType<typeof createCreateTicket>;

    let clockCalls: number;
    let eventIdGeneratorCalls: number;

    async function expectNoCreation(idempotencyKey: string) {
        const persistidos = await unitOfWork.execute(
            async ({ tickets, ticketEvents, idempotencyRecords }) => {
                const ticket = await tickets.findById("INC-1");
                const events = await ticketEvents.listByTicket("INC-1");
                const record = await idempotencyRecords.findByKey(idempotencyKey);

                return { ticket, events, record };
            },
        );

        expect(persistidos.ticket).toBeUndefined();
        expect(persistidos.events).toStrictEqual([]);
        expect(persistidos.record).toBeUndefined();
    }

    beforeAll(async () => {
        db = await createTestDatabase();
        unitOfWork = createUnitOfWork(db.prisma);
    });

    beforeEach(async () => {
        await db.reset();

        clockCalls = 0;
        eventIdGeneratorCalls = 0;

        const clock = {
            now(): string {
                clockCalls += 1;
                return NOW;
            },
        };

        const eventIdGenerator = {
            generate(): string {
                eventIdGeneratorCalls += 1;

                return `EVT-TEST-${String(eventIdGeneratorCalls).padStart(3, "0")}`;
            },
        };

        createTicket = createCreateTicket({
            unitOfWork,
            eventIdGenerator,
            clock,
        });
    });

    afterAll(async () => {
        await db.dispose();
    });

    it("cria o chamado, o evento CREATED e o registro de idempotência", async () => {
        const prazoEsperado = computeDueAt(NOW, draft.priority);

        const ticketEsperado: Ticket = {
            id: "INC-1",
            version: 1,
            type: draft.type,
            title: draft.title,
            description: draft.description,
            category: draft.category,
            priority: draft.priority,
            status: "WAITING_ANALYST",
            requesterId: actor.employeeId,
            impactAssessment: draft.impactAssessment,
            createdAt: NOW,
            updatedAt: NOW,
            firstResponseDueAt: prazoEsperado,
        };

        const eventoEsperado: TicketEvent = {
            id: "EVT-TEST-001",
            ticketId: ticketEsperado.id,
            type: "CREATED",
            actor,
            summary: "Chamado criado",
            changes: [],
            occurredAt: NOW,
        };

        const resultado = await createTicket.execute({
            idempotencyKey: IDEMPOTENCY_KEY_1,
            draft,
            actor,
        });

        expect(resultado).toStrictEqual({
            ok: true,
            ticket: ticketEsperado,
        });

        expect(clockCalls).toBe(1);
        expect(eventIdGeneratorCalls).toBe(1);

        const persistidos = await unitOfWork.execute(
            async ({ tickets, ticketEvents, idempotencyRecords }) => {
                const ticket = await tickets.findById(ticketEsperado.id);
                const events = await ticketEvents.listByTicket(ticketEsperado.id);
                const idempotencyRecord = await idempotencyRecords.findByKey(
                    IDEMPOTENCY_KEY_1,
                );

                return { ticket, events, idempotencyRecord };
            },
        );

        expect(persistidos.ticket).toStrictEqual(ticketEsperado);
        expect(persistidos.events).toStrictEqual([eventoEsperado]);

        expect(persistidos.idempotencyRecord).toStrictEqual({
            key: IDEMPOTENCY_KEY_1,
            operationType: "CREATE",
            ticketId: ticketEsperado.id,
            result: {
                ok: true,
                ticket: ticketEsperado,
            },
            createdAt: NOW,
        });

        expect(persistidos.ticket?.firstResponseDueAt).not.toBe(
            draft.firstResponseDueAt,
        );
    });

    it("devolve o snapshot original no replay sem consumir novos recursos", async () => {
        const primeiraResposta = await createTicket.execute({
            idempotencyKey: IDEMPOTENCY_KEY_1,
            draft,
            actor,
        });

        expect(primeiraResposta.ok).toBe(true);

        const respostaRepetida = await createTicket.execute({
            idempotencyKey: IDEMPOTENCY_KEY_1,
            draft,
            actor,
        });

        expect(respostaRepetida).toStrictEqual(primeiraResposta);
        expect(clockCalls).toBe(1);
        expect(eventIdGeneratorCalls).toBe(1);

        const estadoAposReplay = await unitOfWork.execute(
            async ({ tickets, ticketEvents }) => {
                const primeiroChamado = await tickets.findById("INC-1");
                const segundoChamado = await tickets.findById("INC-2");
                const eventos = await ticketEvents.listByTicket("INC-1");

                return {
                    primeiroChamado,
                    segundoChamado,
                    eventos,
                };
            },
        );

        expect(estadoAposReplay.primeiroChamado).toStrictEqual(
            primeiraResposta.ok ? primeiraResposta.ticket : undefined,
        );
        expect(estadoAposReplay.segundoChamado).toBeUndefined();
        expect(estadoAposReplay.eventos).toHaveLength(1);

        const terceiraResposta = await createTicket.execute({
            idempotencyKey: IDEMPOTENCY_KEY_2,
            draft,
            actor,
        });

        expect(terceiraResposta).toMatchObject({
            ok: true,
            ticket: {
                id: "INC-2",
            },
        });

        expect(clockCalls).toBe(2);
        expect(eventIdGeneratorCalls).toBe(2);
    });


    // Teste 3: prova que o replay acontece antes da validação do novo draft.
    it("devolve o snapshot original quando a mesma chave chega com outra prioridade", async () => {
        const primeiraResposta = await createTicket.execute({
            idempotencyKey: IDEMPOTENCY_KEY_3,
            draft,
            actor,
        });

        expect(primeiraResposta).toMatchObject({
            ok: true,
            ticket: {
                id: "INC-1",
                priority: "LOW",
            },
        });

        const respostaRepetida = await createTicket.execute({
            idempotencyKey: IDEMPOTENCY_KEY_3,
            draft: draftPrioridadeHigh,
            actor,
        });

        expect(respostaRepetida).toStrictEqual(primeiraResposta);
        expect(clockCalls).toBe(1);
        expect(eventIdGeneratorCalls).toBe(1);

        const persistidos = await unitOfWork.execute(
            async ({ tickets, ticketEvents, idempotencyRecords }) => {
                return {
                    ticket: await tickets.findById("INC-1"),
                    segundoTicket: await tickets.findById("INC-2"),
                    events: await ticketEvents.listByTicket("INC-1"),
                    record: await idempotencyRecords.findByKey(
                        IDEMPOTENCY_KEY_3,
                    ),
                };
            },
        );

        expect(persistidos.segundoTicket).toBeUndefined();
        expect(persistidos.ticket?.priority).toBe("LOW");
        expect(persistidos.events).toHaveLength(1);
        expect(persistidos.record?.result).toStrictEqual(primeiraResposta);
    });

    // Teste 4: prova que o ator é validado antes da consulta da chave.
    it("rejeita ANALYST e SYSTEM sem gravar, mesmo quando a chave já existe", async () => {
        const rejeicoes = [
            {
                actor: actorAnalyst,
                key: IDEMPOTENCY_KEY_4_ANALYST,
            },
            {
                actor: actorSystem,
                key: IDEMPOTENCY_KEY_4_SYSTEM,
            },
        ] as const;

        for (const { actor: atorInvalido, key } of rejeicoes) {
            const resultado = await createTicket.execute({
                idempotencyKey: key,
                draft,
                actor: atorInvalido,
            });

            expect(resultado).toStrictEqual({
                ok: false,
                error: "ACTOR_NOT_EMPLOYEE",
            });

            await expectNoCreation(key);
        }

        const respostaOriginal = await createTicket.execute({
            idempotencyKey: IDEMPOTENCY_KEY_4,
            draft,
            actor,
        });

        expect(respostaOriginal).toMatchObject({
            ok: true,
            ticket: { id: "INC-1" },
        });

        for (const atorInvalido of [actorAnalyst, actorSystem]) {
            const resultado = await createTicket.execute({
                idempotencyKey: IDEMPOTENCY_KEY_4,
                draft,
                actor: atorInvalido,
            });

            expect(resultado).toStrictEqual({
                ok: false,
                error: "ACTOR_NOT_EMPLOYEE",
            });
        }

        expect(clockCalls).toBe(1);
        expect(eventIdGeneratorCalls).toBe(1);

        const persistidos = await unitOfWork.execute(
            async ({ tickets, ticketEvents, idempotencyRecords }) => {
                return {
                    ticket: await tickets.findById("INC-1"),
                    segundoTicket: await tickets.findById("INC-2"),
                    events: await ticketEvents.listByTicket("INC-1"),
                    record: await idempotencyRecords.findByKey(
                        IDEMPOTENCY_KEY_4,
                    ),
                };
            },
        );

        expect(persistidos.ticket?.requesterId).toBe(actor.employeeId);
        expect(persistidos.segundoTicket).toBeUndefined();
        expect(persistidos.events).toHaveLength(1);
        expect(persistidos.record?.result).toStrictEqual(respostaOriginal);
    });

    // Teste 5: prova que impacto inválido não consome a chave.
    it("rejeita impacto inválido e permite reutilizar a chave com draft válido", async () => {
        const resultadoInvalido = await createTicket.execute({
            idempotencyKey: IDEMPOTENCY_KEY_5,
            draft: draftImpactoInvalido,
            actor,
        });

        expect(resultadoInvalido).toStrictEqual({
            ok: false,
            error: "INVALID_IMPACT_ASSESSMENT",
        });

        await expectNoCreation(IDEMPOTENCY_KEY_5);

        const resultadoValido = await createTicket.execute({
            idempotencyKey: IDEMPOTENCY_KEY_5,
            draft,
            actor,
        });

        expect(resultadoValido).toMatchObject({
            ok: true,
            ticket: {
                id: "INC-1",
                priority: "LOW",
            },
        });

        expect(clockCalls).toBe(1);
        expect(eventIdGeneratorCalls).toBe(1);
    });

    // Teste 6: prova que divergência de prioridade não consome a chave.
    it("rejeita prioridade divergente e permite reutilizar a chave", async () => {
        const resultadoDivergente = await createTicket.execute({
            idempotencyKey: IDEMPOTENCY_KEY_6,
            draft: draftPrioridadeMedium,
            actor,
        });

        expect(resultadoDivergente).toStrictEqual({
            ok: false,
            error: "PRIORITY_MISMATCH",
        });

        await expectNoCreation(IDEMPOTENCY_KEY_6);

        const resultadoValido = await createTicket.execute({
            idempotencyKey: IDEMPOTENCY_KEY_6,
            draft,
            actor,
        });

        expect(resultadoValido).toMatchObject({
            ok: true,
            ticket: {
                id: "INC-1",
                priority: "LOW",
            },
        });

        expect(clockCalls).toBe(1);
        expect(eventIdGeneratorCalls).toBe(1);
    });

    // Teste 7: prova que a chave não revela o snapshot de outro funcionário.
    it("rejeita a reutilização da chave por outro funcionário", async () => {
        const respostaOriginal = await createTicket.execute({
            idempotencyKey: IDEMPOTENCY_KEY_7,
            draft,
            actor,
        });

        expect(respostaOriginal).toMatchObject({
            ok: true,
            ticket: {
                id: "INC-1",
                requesterId: actor.employeeId,
            },
        });

        const resultadoConflitante = await createTicket.execute({
            idempotencyKey: IDEMPOTENCY_KEY_7,
            draft,
            actor: outroFuncionario,
        });

        expect(resultadoConflitante).toStrictEqual({
            ok: false,
            error: "IDEMPOTENCY_KEY_CONFLICT",
        });

        expect(clockCalls).toBe(1);
        expect(eventIdGeneratorCalls).toBe(1);

        const persistidos = await unitOfWork.execute(
            async ({ tickets, ticketEvents, idempotencyRecords }) => {
                return {
                    ticket: await tickets.findById("INC-1"),
                    segundoTicket: await tickets.findById("INC-2"),
                    events: await ticketEvents.listByTicket("INC-1"),
                    record: await idempotencyRecords.findByKey(
                        IDEMPOTENCY_KEY_7,
                    ),
                };
            },
        );

        expect(persistidos.ticket?.requesterId).toBe(actor.employeeId);
        expect(persistidos.segundoTicket).toBeUndefined();
        expect(persistidos.events).toHaveLength(1);
        expect(persistidos.record?.result).toStrictEqual(respostaOriginal);
    });

    // Teste 8: prova atomicidade e que somente o P2002 da chave é recuperável.
    it("desfaz toda a criação quando o evento viola sua chave primária", async () => {
        await unitOfWork.execute(async ({ tickets, ticketEvents }) => {
            await tickets.create(chamadoAncora);
            await ticketEvents.create(eventoConflitante);
        });

        await expect(
            createTicket.execute({
                idempotencyKey: IDEMPOTENCY_KEY_8,
                draft,
                actor,
            }),
        ).rejects.toMatchObject({
            code: "P2002",
        });

        await expectNoCreation(IDEMPOTENCY_KEY_8);

        const eventoOriginal = await unitOfWork.execute(
            async ({ ticketEvents }) => {
                return ticketEvents.listByTicket(chamadoAncora.id);
            },
        );

        expect(eventoOriginal).toStrictEqual([eventoConflitante]);

        const resultadoRecuperacao = await createTicket.execute({
            idempotencyKey: IDEMPOTENCY_KEY_8_RECOVERY,
            draft,
            actor,
        });

        expect(resultadoRecuperacao).toMatchObject({
            ok: true,
            ticket: {
                id: "INC-1",
                priority: "LOW",
            },
        });

        expect(clockCalls).toBe(2);
        expect(eventIdGeneratorCalls).toBe(2);
    });

    // Teste 9: prova que duas execuções concorrentes produzem um único efeito.
    it("processa duas execuções concorrentes com a mesma chave uma única vez", async () => {
        const resultados = await Promise.all([
            createTicket.execute({
                idempotencyKey: IDEMPOTENCY_KEY_9,
                draft,
                actor,
            }),
            createTicket.execute({
                idempotencyKey: IDEMPOTENCY_KEY_9,
                draft,
                actor,
            }),
        ]);

        expect(resultados[0]).toMatchObject({
            ok: true,
            ticket: {
                id: "INC-1",
                priority: "LOW",
            },
        });

        expect(resultados[1]).toStrictEqual(resultados[0]);

        expect(clockCalls).toBe(1);
        expect(eventIdGeneratorCalls).toBe(1);

        const persistidos = await unitOfWork.execute(
            async ({ tickets, ticketEvents, idempotencyRecords }) => {
                return {
                    ticket: await tickets.findById("INC-1"),
                    segundoTicket: await tickets.findById("INC-2"),
                    events: await ticketEvents.listByTicket("INC-1"),
                    record: await idempotencyRecords.findByKey(
                        IDEMPOTENCY_KEY_9,
                    ),
                };
            },
        );

        expect(persistidos.ticket).toBeDefined();
        expect(persistidos.segundoTicket).toBeUndefined();
        expect(persistidos.events).toHaveLength(1);
        expect(persistidos.record?.result).toStrictEqual(resultados[0]);
    });
});
