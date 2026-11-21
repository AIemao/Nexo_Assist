import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createListMyTickets, type ListMyTicketsInput, type TicketView } from "../../src/application/list-my-tickets.js";
import { createViewMyTicket, type ViewMyTicketInput } from "../../src/application/view-my-ticket.js";
import type { Ticket } from "../../src/domain/index.js";
import { createApp, type AppDependencies } from "../../src/http/app.js";
import type { ReadRecord } from "../../src/http/read-record.js";
import { createUnitOfWork } from "../../src/persistence/unit-of-work.js";
import { createTestDatabase } from "../support/test-database.js";

// Contrato HTTP v1.3, §7 a §9, §11 e §12; cenários §1.1, IL1–IL7 (registro ticket_read).

const NOW = "2026-11-20T15:00:00.000Z";
const T1 = "2026-11-10T12:00:00.000Z";
const T2 = "2026-11-15T12:00:00.000Z";
const T3 = "2026-11-18T12:00:00.000Z";
const PRAZO_PASSADO = "2026-11-19T12:00:00.000Z";
const PRAZO_FUTURO = "2026-11-25T12:00:00.000Z";

const IMPACTO = { workImpact: "NONE", affectedScope: "SELF", commitmentRisk: "NO" } as const;

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
        impactAssessment: IMPACTO,
        createdAt: T2,
        updatedAt: T2,
        firstResponseDueAt: PRAZO_FUTURO,
        ...overrides,
    };
}

// EMP-001: quatro chamados de status diferentes. INC-3 e REQ-1 têm o mesmo updatedAt (T2):
// o empate controlado é desempatado por id crescente (§8.3; R5).
const INC_1 = chamado({ id: "INC-1", createdAt: T3, updatedAt: T3, firstResponseDueAt: PRAZO_PASSADO });
const INC_3 = chamado({ id: "INC-3" });
const REQ_1 = chamado({
    id: "REQ-1",
    type: "REQ",
    status: "APPROVED",
    firstResponseDueAt: PRAZO_PASSADO,
    serviceDeskUpdatedAt: T2,
    nextUpdateDueAt: PRAZO_FUTURO,
});
const INC_2 = chamado({
    id: "INC-2",
    status: "RESOLVED",
    createdAt: T1,
    updatedAt: T1,
    resolvedAt: T1,
    firstResponseDueAt: PRAZO_PASSADO,
});
// EMP-002: chamado de outro funcionário.
const INC_9 = chamado({ id: "INC-9", requesterId: "EMP-002" });

const CABECALHOS_EMP_001 = { "X-Actor-Type": "EMPLOYEE", "X-Actor-Employee-Id": "EMP-001" };

const createTicketNaoUsado: AppDependencies["createTicket"] = {
    execute: () => Promise.reject(new Error("POST /tickets não é usado nestes testes")),
};

describe("Leituras do funcionário: GET /tickets e GET /tickets/{ticketId}", () => {
    let db: Awaited<ReturnType<typeof createTestDatabase>>;
    let unitOfWork: ReturnType<typeof createUnitOfWork>;

    beforeAll(async () => {
        db = await createTestDatabase();
        unitOfWork = createUnitOfWork(db.prisma);
        await db.reset();
        await db.createEmployees("EMP-001", "EMP-002");
        await unitOfWork.execute(async ({ tickets }) => {
            for (const ticket of [INC_1, INC_3, REQ_1, INC_2, INC_9]) {
                await tickets.create(ticket);
            }
        });
    });

    afterAll(async () => {
        await db.dispose();
    });

    function montar(substituicoes: Partial<AppDependencies> = {}) {
        const registros: ReadRecord[] = [];
        const erros: unknown[] = [];
        const clock = { now: () => NOW };
        const app = createApp({
            createTicket: createTicketNaoUsado,
            listMyTickets: createListMyTickets({ unitOfWork, clock }),
            viewMyTicket: createViewMyTicket({ unitOfWork, clock }),
            recordRead: (record) => {
                registros.push(record);
            },
            onUnexpectedError: (error) => {
                erros.push(error);
            },
            ...substituicoes,
        });
        return { app, registros, erros };
    }

    function get(app: ReturnType<typeof createApp>, path: string, headers: Record<string, string> = CABECALHOS_EMP_001) {
        return app.request(path, { method: "GET", headers });
    }

    async function contagens() {
        return {
            chamados: await db.prisma.ticket.count(),
            eventos: await db.prisma.ticketEvent.count(),
            registros: await db.prisma.idempotencyRecord.count(),
        };
    }

    describe("GET /tickets (§8)", () => {
        it("lista só os chamados do ator, de qualquer status, em resumo e na ordem do §8.3", async () => {
            const { app } = montar();

            const response = await get(app, "/tickets");

            expect(response.status).toBe(200);
            expect(response.headers.get("content-type")?.split(";")[0]).toBe("application/json");
            // Ordem: updatedAt decrescente; INC-3 e REQ-1 empatam em T2 e saem por id crescente.
            // isOverdue (§12): RESOLVED → null; demais status → isOverdue(prazo vigente, now).
            expect(await response.json()).toStrictEqual({
                tickets: [
                    {
                        id: "INC-1",
                        type: "INC",
                        title: "Chamado INC-1",
                        category: "HARDWARE",
                        priority: "LOW",
                        status: "WAITING_ANALYST",
                        createdAt: T3,
                        updatedAt: T3,
                        currentDueAt: PRAZO_PASSADO,
                        isOverdue: true,
                    },
                    {
                        id: "INC-3",
                        type: "INC",
                        title: "Chamado INC-3",
                        category: "HARDWARE",
                        priority: "LOW",
                        status: "WAITING_ANALYST",
                        createdAt: T2,
                        updatedAt: T2,
                        currentDueAt: PRAZO_FUTURO,
                        isOverdue: false,
                    },
                    {
                        id: "REQ-1",
                        type: "REQ",
                        title: "Chamado REQ-1",
                        category: "HARDWARE",
                        priority: "LOW",
                        status: "APPROVED",
                        createdAt: T2,
                        updatedAt: T2,
                        // Prazo vigente = nextUpdateDueAt (DM §3.2).
                        currentDueAt: PRAZO_FUTURO,
                        isOverdue: false,
                    },
                    {
                        id: "INC-2",
                        type: "INC",
                        title: "Chamado INC-2",
                        category: "HARDWARE",
                        priority: "LOW",
                        status: "RESOLVED",
                        createdAt: T1,
                        updatedAt: T1,
                        resolvedAt: T1,
                        currentDueAt: PRAZO_PASSADO,
                        isOverdue: null,
                    },
                ],
            });
        });

        it("ator sem chamados: 200 com a lista vazia", async () => {
            const { app } = montar();

            const response = await get(app, "/tickets", { "X-Actor-Type": "EMPLOYEE", "X-Actor-Employee-Id": "EMP-404" });

            expect(response.status).toBe(200);
            expect(await response.text()).toBe('{"tickets":[]}');
        });
    });

    describe("GET /tickets/{ticketId} (§9)", () => {
        it("objeto ticket sem envelope, com currentDueAt e isOverdue no mesmo nível", async () => {
            const { app } = montar();

            const response = await get(app, "/tickets/REQ-1");

            expect(response.status).toBe(200);
            expect(await response.json()).toStrictEqual({
                ...REQ_1,
                currentDueAt: PRAZO_FUTURO,
                isOverdue: false,
            });
        });

        it("campos opcionais ausentes são omitidos", async () => {
            const { app } = montar();

            const corpo = (await (await get(app, "/tickets/INC-3")).json()) as Record<string, unknown>;

            expect(corpo).toStrictEqual({ ...INC_3, currentDueAt: PRAZO_FUTURO, isOverdue: false });
            for (const campo of ["resolvedAt", "assignedTo", "nextUpdateDueAt", "serviceDeskUpdatedAt"]) {
                expect(corpo).not.toHaveProperty(campo);
            }
        });

        it("chamado RESOLVED: resolvedAt presente e isOverdue null", async () => {
            const { app } = montar();

            const corpo = await (await get(app, "/tickets/INC-2")).json();

            expect(corpo).toStrictEqual({ ...INC_2, currentDueAt: PRAZO_PASSADO, isOverdue: null });
        });

        it("404 idêntico byte a byte para inexistente, de outro funcionário e malformado (§9.2)", async () => {
            const { app } = montar();

            const respostas = await Promise.all(
                ["/tickets/INC-999999", "/tickets/INC-9", "/tickets/abc"].map(async (path) => {
                    const response = await get(app, path);
                    return {
                        status: response.status,
                        cabecalhos: [...response.headers.entries()].sort(),
                        corpo: await response.text(),
                    };
                }),
            );

            const [inexistente, deOutro, malformado] = respostas;
            expect(inexistente).toStrictEqual({
                status: 404,
                cabecalhos: [["content-type", "application/problem+json"]],
                corpo: '{"type":"about:blank","title":"Not Found","status":404,"code":"TICKET_NOT_FOUND"}',
            });
            expect(deOutro).toStrictEqual(inexistente);
            expect(malformado).toStrictEqual(inexistente);
        });
    });

    describe("ordem de validação (§11)", () => {
        it("cabeçalho inválido com parâmetro extra: só os erros de cabeçalho", async () => {
            const { app } = montar();

            const response = await get(app, "/tickets?extra=1", { "X-Actor-Type": "SUPERVISOR" });

            expect(response.status).toBe(400);
            const corpo = (await response.json()) as { code: string; errors: { path: string }[] };
            expect(corpo.code).toBe("VALIDATION_ERROR");
            expect(corpo.errors.length).toBeGreaterThan(0);
            for (const erro of corpo.errors) {
                expect(erro.path.startsWith("X-Actor-")).toBe(true);
            }
        });

        it("ANALYST com parâmetro extra: 400, e não 403", async () => {
            const { app } = montar();

            const response = await get(app, "/tickets?extra=1", { "X-Actor-Type": "ANALYST", "X-Actor-Employee-Id": "ANL-001" });

            expect(response.status).toBe(400);
            const corpo = (await response.json()) as { code: string; errors: { path: string }[] };
            expect(corpo.code).toBe("VALIDATION_ERROR");
            expect(corpo.errors.map((erro) => erro.path)).toStrictEqual(["?extra"]);
        });

        it.each<[string, Record<string, string>]>([
            ["ANALYST", { "X-Actor-Type": "ANALYST", "X-Actor-Employee-Id": "ANL-001" }],
            ["SYSTEM", { "X-Actor-Type": "SYSTEM" }],
        ])("%s válido: 403 ACTOR_NOT_EMPLOYEE sem chamar o caso de uso", async (_nome, cabecalhos) => {
            const chamadas: unknown[] = [];
            const { app } = montar({
                listMyTickets: {
                    execute: (input: ListMyTicketsInput) => {
                        chamadas.push(input);
                        return Promise.reject(new Error("o caso de uso não pode ser chamado"));
                    },
                },
                viewMyTicket: {
                    execute: (input: ViewMyTicketInput) => {
                        chamadas.push(input);
                        return Promise.reject(new Error("o caso de uso não pode ser chamado"));
                    },
                },
            });

            for (const path of ["/tickets", "/tickets/INC-1"]) {
                const response = await get(app, path, cabecalhos);
                expect(response.status).toBe(403);
                expect(await response.json()).toStrictEqual({
                    type: "about:blank",
                    title: "Forbidden",
                    status: 403,
                    code: "ACTOR_NOT_EMPLOYEE",
                });
            }
            expect(chamadas).toStrictEqual([]);
        });

        it("?requesterId=EMP-B: 400 com path ?requesterId", async () => {
            const { app } = montar();

            const response = await get(app, "/tickets?requesterId=EMP-B");

            expect(response.status).toBe(400);
            const corpo = (await response.json()) as { code: string; errors: { path: string }[] };
            expect(corpo.code).toBe("VALIDATION_ERROR");
            expect(corpo.errors.map((erro) => erro.path)).toStrictEqual(["?requesterId"]);
        });
    });

    describe("registro ticket_read: um único registro por caminho (IL1–IL7)", () => {
        it("LIST + OK", async () => {
            const { app, registros } = montar();

            await get(app, "/tickets");

            expect(registros).toStrictEqual([
                { event: "ticket_read", operation: "LIST", outcome: "OK", status: 200, responseDisposition: "SENT" },
            ]);
        });

        it("VIEW + OK, com ticketId", async () => {
            const { app, registros } = montar();

            await get(app, "/tickets/INC-1");

            expect(registros).toStrictEqual([
                {
                    event: "ticket_read",
                    operation: "VIEW",
                    outcome: "OK",
                    status: 200,
                    ticketId: "INC-1",
                    responseDisposition: "SENT",
                },
            ]);
        });

        it("REJECTED/403", async () => {
            const { app, registros } = montar();

            await get(app, "/tickets", { "X-Actor-Type": "ANALYST", "X-Actor-Employee-Id": "ANL-001" });

            expect(registros).toStrictEqual([
                {
                    event: "ticket_read",
                    operation: "LIST",
                    outcome: "REJECTED",
                    status: 403,
                    code: "ACTOR_NOT_EMPLOYEE",
                    responseDisposition: "SENT",
                },
            ]);
        });

        it("REJECTED/404 sem ticketId e igual nas três causas", async () => {
            const esperado: ReadRecord = {
                event: "ticket_read",
                operation: "VIEW",
                outcome: "REJECTED",
                status: 404,
                code: "TICKET_NOT_FOUND",
                responseDisposition: "SENT",
            };

            for (const path of ["/tickets/INC-999999", "/tickets/INC-9", "/tickets/abc"]) {
                const { app, registros } = montar();
                await get(app, path);
                expect(registros).toStrictEqual([esperado]);
            }
        });

        it("INVALID/400", async () => {
            const { app, registros } = montar();

            await get(app, "/tickets?requesterId=EMP-B");

            expect(registros).toStrictEqual([
                {
                    event: "ticket_read",
                    operation: "LIST",
                    outcome: "INVALID",
                    status: 400,
                    code: "VALIDATION_ERROR",
                    responseDisposition: "SENT",
                },
            ]);
        });

        it("ERROR/500: exceção real no caso de uso, pelo onError, com corpo genérico", async () => {
            const falha = new Error("detalhe interno: SELECT * FROM Ticket");
            const { app, registros, erros } = montar({
                viewMyTicket: { execute: () => Promise.reject(falha) },
            });

            const response = await get(app, "/tickets/INC-1");

            expect(response.status).toBe(500);
            expect(await response.text()).toBe(
                '{"type":"about:blank","title":"Internal Server Error","status":500,"code":"INTERNAL_ERROR"}',
            );
            expect(erros).toStrictEqual([falha]);
            expect(registros).toStrictEqual([
                {
                    event: "ticket_read",
                    operation: "VIEW",
                    outcome: "ERROR",
                    status: 500,
                    code: "INTERNAL_ERROR",
                    responseDisposition: "SENT",
                },
            ]);
        });
    });

    it("as leituras não alteram chamados, eventos nem registros de idempotência (IL4)", async () => {
        const { app } = montar();
        const antes = await contagens();

        await get(app, "/tickets");
        await get(app, "/tickets/INC-1");
        await get(app, "/tickets/INC-9");
        await get(app, "/tickets", { "X-Actor-Type": "ANALYST", "X-Actor-Employee-Id": "ANL-001" });
        await get(app, "/tickets?requesterId=EMP-B");

        expect(await contagens()).toStrictEqual(antes);
    });

    // R3 do plano: fixa o comportamento observado (Hono 4.13.14, 2026-11-21). O HEAD casa com a
    // rota GET de listagem: responde 200 sem corpo, com o Content-Type do GET, e gera um
    // ticket_read LIST/OK.
    it("HEAD /tickets: 200 sem corpo e um ticket_read LIST/OK (comportamento observado, R3)", async () => {
        const { app, registros } = montar();

        const response = await app.request("/tickets", { method: "HEAD", headers: CABECALHOS_EMP_001 });

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("");
        expect([...response.headers.entries()].sort()).toStrictEqual([["content-type", "application/json"]]);
        expect(registros).toStrictEqual([
            { event: "ticket_read", operation: "LIST", outcome: "OK", status: 200, responseDisposition: "SENT" },
        ]);
    });
});

// Garante que TicketView está exportado com a forma usada pela camada HTTP.
export type TicketViewCheck = TicketView;
