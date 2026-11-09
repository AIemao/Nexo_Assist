import { serve, type ServerType } from "@hono/node-server";
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { createCreateTicket } from "../../src/application/create-ticket.js";
import type { CreateTicketDraft } from "../../src/domain/index.js";
import { createApp } from "../../src/http/app.js";
import type { SimulatedFault } from "../../src/http/simulated-fault.js";
import type { WriteRecord } from "../../src/http/write-record.js";
import {
    createUnitOfWork,
    type UnitOfWork,
} from "../../src/persistence/unit-of-work.js";
import { createTestDatabase } from "../support/test-database.js";

const NOW = "2026-11-07T12:00:00.000Z";

const IDEMPOTENCY_KEY = "00000000-0000-4000-8000-000000000001";
const OUTRA_IDEMPOTENCY_KEY = "00000000-0000-4000-8000-000000000002";

// Folga grande: requisições normais levam dezenas de ms. Só limites inferiores.
const DELAY_MS = 500;

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

const draftInvalido = {
    ...draft,
    campoExtra: true,
};

const draftPrioridadeDivergente = {
    ...draft,
    priority: "HIGH",
} satisfies CreateTicketDraft;

// Cenários §1.1, IN4: campos fixos de todo registro de escrita.
function registro(campos: Omit<WriteRecord, "event" | "operation">): WriteRecord {
    return { event: "ticket_write", operation: "CREATE", ...campos };
}

function validHeaders(idempotencyKey: string): Record<string, string> {
    return {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        "X-Actor-Type": "EMPLOYEE",
        "X-Actor-Employee-Id": "EMP-001",
    };
}

function subirServidor(app: ReturnType<typeof createApp>): Promise<{ servidor: ServerType; baseUrl: string }> {
    return new Promise((resolve, reject) => {
        const servidor = serve(
            { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
            (info) => resolve({ servidor, baseUrl: `http://127.0.0.1:${info.port}` }),
        );
        servidor.once("error", reject);
    });
}

function fecharServidor(servidor: ServerType): Promise<void> {
    return new Promise((resolve, reject) => {
        servidor.close((erro) => (erro ? reject(erro) : resolve()));
        if ("closeAllConnections" in servidor) {
            servidor.closeAllConnections();
        }
    });
}

describe("Falhas simuladas no transporte (servidor real, porta 0)", () => {
    let db: Awaited<ReturnType<typeof createTestDatabase>>;
    let unitOfWork: UnitOfWork;
    let servidor: ServerType | undefined;
    let baseUrl: string;
    let registros: WriteRecord[] = [];

    beforeAll(async () => {
        db = await createTestDatabase();
        unitOfWork = createUnitOfWork(db.prisma);
    });

    beforeEach(async () => {
        await db.reset();
    });

    afterEach(async () => {
        if (servidor !== undefined) {
            await fecharServidor(servidor);
            servidor = undefined;
        }
    });

    afterAll(async () => {
        await db.dispose();
    });

    // Uma instância de app por teste: a falha começa armada (FS6). O coletor recebe os
    // registros das escritas (cenários §1.1) na ordem em que o servidor os emite.
    async function ligar(simulatedFault: SimulatedFault): Promise<void> {
        let n = 0;
        const createTicket = createCreateTicket({
            unitOfWork,
            eventIdGenerator: { generate: () => `EVT-FAULT-${++n}` },
            clock: { now: () => NOW },
        });
        registros = [];
        const app = createApp({
            createTicket,
            simulatedFault,
            recordWrite: (record) => {
                registros.push(record);
            },
        });
        ({ servidor, baseUrl } = await subirServidor(app));
    }

    // Nos cortes, o fetch pode rejeitar antes de o servidor emitir o registro: os dois
    // rodam no mesmo processo, por caminhos diferentes do event loop. Espera o tamanho
    // esperado antes de comparar.
    async function registrosEmitidos(quantidade: number): Promise<WriteRecord[]> {
        await vi.waitFor(() => {
            expect(registros).toHaveLength(quantidade);
        });
        return registros;
    }

    function post(body: object, idempotencyKey = IDEMPOTENCY_KEY): Promise<Response> {
        return fetch(`${baseUrl}/tickets`, {
            method: "POST",
            headers: validHeaders(idempotencyKey),
            body: JSON.stringify(body),
        });
    }

    // Devolve o erro do fetch ou, se houve resposta HTTP, uma descrição dela.
    async function postSemResposta(body: object): Promise<unknown> {
        try {
            const resposta = await post(body);
            return `resposta HTTP ${resposta.status}`;
        } catch (erro) {
            return erro;
        }
    }

    async function contagens() {
        return {
            chamados: await db.prisma.ticket.count(),
            eventos: await db.prisma.ticketEvent.count(),
            registros: await db.prisma.idempotencyRecord.count(),
        };
    }

    async function ultimoNumeroInc(): Promise<number | undefined> {
        const contador = await db.prisma.ticketCounter.findUnique({ where: { type: "INC" } });
        return contador?.lastNumber;
    }

    describe("F-DROP-AFTER", () => {
        beforeEach(async () => {
            await ligar({ mode: "F-DROP-AFTER" });
        });

        // Registro do corte depois do commit: CREATED com o 201 que seria enviado (IN4).
        const cortado = registro({
            outcome: "CREATED",
            status: 201,
            idempotencyKey: IDEMPOTENCY_KEY,
            ticketId: "INC-1",
            fault: "F-DROP-AFTER",
            responseDisposition: "DROPPED",
        });

        it("grava o chamado e encerra a conexão sem resposta HTTP", async () => {
            const resultado = await postSemResposta(draft);

            expect(resultado).toBeInstanceOf(TypeError);
            expect(resultado).toHaveProperty("cause", expect.anything());

            expect(await contagens()).toStrictEqual({ chamados: 1, eventos: 1, registros: 1 });
            expect(await registrosEmitidos(1)).toStrictEqual([cortado]);
        });

        it("a repetição com a mesma chave devolve o chamado gravado, sem nova gravação", async () => {
            expect(await postSemResposta(draft)).toBeInstanceOf(TypeError);
            await registrosEmitidos(1);
            const [gravado] = await db.prisma.ticket.findMany();
            expect(gravado).toBeDefined();

            const resposta = await post(draft);

            expect(resposta.status).toBe(201);
            expect(await resposta.json()).toMatchObject({ id: gravado?.id });
            expect(await contagens()).toStrictEqual({ chamados: 1, eventos: 1, registros: 1 });
            expect(await ultimoNumeroInc()).toBe(1);
            // A falha já foi consumida: a repetição sai normal, com o mesmo ticketId.
            expect(await registrosEmitidos(2)).toStrictEqual([
                cortado,
                registro({
                    outcome: "REPLAYED",
                    status: 201,
                    idempotencyKey: IDEMPOTENCY_KEY,
                    ticketId: "INC-1",
                    responseDisposition: "SENT",
                }),
            ]);
        });

        it("requisição inválida não consome a falha", async () => {
            const invalida = await post(draftInvalido);
            expect(invalida.status).toBe(400);

            const resultado = await postSemResposta(draft);

            expect(resultado).toBeInstanceOf(TypeError);
            expect(await contagens()).toStrictEqual({ chamados: 1, eventos: 1, registros: 1 });
            expect(await registrosEmitidos(2)).toStrictEqual([
                registro({
                    outcome: "INVALID",
                    status: 400,
                    code: "VALIDATION_ERROR",
                    idempotencyKey: IDEMPOTENCY_KEY,
                    responseDisposition: "SENT",
                }),
                cortado,
            ]);
        });

        // A prova de que a falha continuou pendente é o corte da requisição seguinte.
        it("rejeição de negócio não consome a falha", async () => {
            const rejeitada = await post(draftPrioridadeDivergente);
            expect(rejeitada.status).toBe(422);
            expect(await contagens()).toStrictEqual({ chamados: 0, eventos: 0, registros: 0 });

            const resultado = await postSemResposta(draft);

            expect(resultado).toBeInstanceOf(TypeError);
            expect(await contagens()).toStrictEqual({ chamados: 1, eventos: 1, registros: 1 });
            expect(await registrosEmitidos(2)).toStrictEqual([
                registro({
                    outcome: "REJECTED",
                    status: 422,
                    code: "PRIORITY_MISMATCH",
                    idempotencyKey: IDEMPOTENCY_KEY,
                    responseDisposition: "SENT",
                }),
                cortado,
            ]);
        });
    });

    describe("F-DROP-BEFORE", () => {
        beforeEach(async () => {
            await ligar({ mode: "F-DROP-BEFORE" });
        });

        // Registro do corte antes do caso de uso: sem status nem code (IN4).
        const naoExecutado = registro({
            outcome: "NOT_EXECUTED",
            idempotencyKey: IDEMPOTENCY_KEY,
            fault: "F-DROP-BEFORE",
            responseDisposition: "DROPPED",
        });

        const criado = registro({
            outcome: "CREATED",
            status: 201,
            idempotencyKey: IDEMPOTENCY_KEY,
            ticketId: "INC-1",
            responseDisposition: "SENT",
        });

        it("não grava nada e encerra a conexão sem resposta HTTP", async () => {
            const resultado = await postSemResposta(draft);

            expect(resultado).toBeInstanceOf(TypeError);
            expect(resultado).toHaveProperty("cause", expect.anything());

            expect(await contagens()).toStrictEqual({ chamados: 0, eventos: 0, registros: 0 });
            expect(await registrosEmitidos(1)).toStrictEqual([naoExecutado]);
        });

        it("a repetição com a mesma chave cria o chamado", async () => {
            expect(await postSemResposta(draft)).toBeInstanceOf(TypeError);
            await registrosEmitidos(1);

            const resposta = await post(draft);

            expect(resposta.status).toBe(201);
            const [criadoNoBanco] = await db.prisma.ticket.findMany();
            expect(criadoNoBanco).toBeDefined();
            expect(await resposta.json()).toMatchObject({ id: criadoNoBanco?.id });
            expect(await contagens()).toStrictEqual({ chamados: 1, eventos: 1, registros: 1 });
            expect(await ultimoNumeroInc()).toBe(1);
            expect(await registrosEmitidos(2)).toStrictEqual([naoExecutado, criado]);
        });

        it("requisição inválida não consome a falha", async () => {
            const invalida = await post(draftInvalido);
            expect(invalida.status).toBe(400);

            const resultado = await postSemResposta(draft);

            expect(resultado).toBeInstanceOf(TypeError);
            expect(await contagens()).toStrictEqual({ chamados: 0, eventos: 0, registros: 0 });
            expect(await registrosEmitidos(2)).toStrictEqual([
                registro({
                    outcome: "INVALID",
                    status: 400,
                    code: "VALIDATION_ERROR",
                    idempotencyKey: IDEMPOTENCY_KEY,
                    responseDisposition: "SENT",
                }),
                naoExecutado,
            ]);
        });

        // FS2: a falha age antes do caso de uso; a regra de negócio nunca é avaliada.
        // O registro do corte não traz code: nenhuma rejeição chegou a acontecer.
        it("rejeição de negócio consome a falha sem chegar ao caso de uso", async () => {
            const resultado = await postSemResposta(draftPrioridadeDivergente);

            expect(resultado).toBeInstanceOf(TypeError);
            expect(await contagens()).toStrictEqual({ chamados: 0, eventos: 0, registros: 0 });
            await registrosEmitidos(1);

            const valida = await post(draft);

            expect(valida.status).toBe(201);
            expect(await contagens()).toStrictEqual({ chamados: 1, eventos: 1, registros: 1 });
            expect(await registrosEmitidos(2)).toStrictEqual([naoExecutado, criado]);
        });
    });

    describe("F-SLOW", () => {
        beforeEach(async () => {
            await ligar({ mode: "F-SLOW", delayMs: DELAY_MS });
        });

        // A resposta é entregue depois do atraso: SENT, com o modo da falha (IN4, IN5).
        const atrasado = registro({
            outcome: "CREATED",
            status: 201,
            idempotencyKey: IDEMPOTENCY_KEY,
            ticketId: "INC-1",
            fault: "F-SLOW",
            responseDisposition: "SENT",
        });

        it("grava antes de responder e entrega o 201 depois do atraso", async () => {
            const inicio = performance.now();
            let respondeu = false;
            const pendente = post(draft).then((resposta) => {
                respondeu = true;
                return resposta;
            });

            await vi.waitFor(async () => {
                expect(await contagens()).toStrictEqual({ chamados: 1, eventos: 1, registros: 1 });
            });
            expect(respondeu).toBe(false);

            const resposta = await pendente;

            expect(resposta.status).toBe(201);
            expect(performance.now() - inicio).toBeGreaterThanOrEqual(DELAY_MS);
            expect(await registrosEmitidos(1)).toStrictEqual([atrasado]);
        });

        // FS4: a espera nunca acontece dentro da transação (conexão única, ADR-008).
        it("não segura a transação: outra requisição grava e responde durante o atraso", async () => {
            let aRespondeu = false;
            const a = post(draft).then((resposta) => {
                aRespondeu = true;
                return resposta;
            });
            await vi.waitFor(async () => {
                expect(await db.prisma.ticket.count()).toBe(1);
            });

            const b = await post(draft, OUTRA_IDEMPOTENCY_KEY);

            expect(b.status).toBe(201);
            expect(aRespondeu).toBe(false);
            expect(await contagens()).toStrictEqual({ chamados: 2, eventos: 2, registros: 2 });

            expect((await a).status).toBe(201);
            // Ordem de emissão, não de envio: o registro sai quando o desfecho é conhecido
            // (IN2), e A só termina depois do atraso. B, com outra chave, sai sem fault.
            expect(await registrosEmitidos(2)).toStrictEqual([
                registro({
                    outcome: "CREATED",
                    status: 201,
                    idempotencyKey: OUTRA_IDEMPOTENCY_KEY,
                    ticketId: "INC-2",
                    responseDisposition: "SENT",
                }),
                atrasado,
            ]);
        });

        it("rejeição de negócio não consome a falha", async () => {
            const rejeitada = await post(draftPrioridadeDivergente);
            expect(rejeitada.status).toBe(422);

            const inicio = performance.now();
            const valida = await post(draft);

            expect(valida.status).toBe(201);
            expect(performance.now() - inicio).toBeGreaterThanOrEqual(DELAY_MS);
            expect(await registrosEmitidos(2)).toStrictEqual([
                registro({
                    outcome: "REJECTED",
                    status: 422,
                    code: "PRIORITY_MISMATCH",
                    idempotencyKey: IDEMPOTENCY_KEY,
                    responseDisposition: "SENT",
                }),
                atrasado,
            ]);
        });
    });
});
