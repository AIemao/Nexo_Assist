import { serve, type ServerType } from "@hono/node-server";
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
} from "vitest";
import { createCreateTicket } from "../../src/application/create-ticket.js";
import type { CreateTicketDraft } from "../../src/domain/index.js";
import { createApp } from "../../src/http/app.js";
import type { SimulatedFault } from "../../src/http/simulated-fault.js";
import {
    createUnitOfWork,
    type UnitOfWork,
} from "../../src/persistence/unit-of-work.js";
import { createTestDatabase } from "../support/test-database.js";

const NOW = "2026-11-07T12:00:00.000Z";

const IDEMPOTENCY_KEY = "00000000-0000-4000-8000-000000000001";

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

function validHeaders(): Record<string, string> {
    return {
        "Content-Type": "application/json",
        "Idempotency-Key": IDEMPOTENCY_KEY,
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

    // Uma instância de app por teste: a falha começa armada (FS6).
    async function ligar(simulatedFault: SimulatedFault): Promise<void> {
        let n = 0;
        const createTicket = createCreateTicket({
            unitOfWork,
            eventIdGenerator: { generate: () => `EVT-FAULT-${++n}` },
            clock: { now: () => NOW },
        });
        const app = createApp({ createTicket, simulatedFault });
        ({ servidor, baseUrl } = await subirServidor(app));
    }

    function post(body: object): Promise<Response> {
        return fetch(`${baseUrl}/tickets`, {
            method: "POST",
            headers: validHeaders(),
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

        it("grava o chamado e encerra a conexão sem resposta HTTP", async () => {
            const resultado = await postSemResposta(draft);

            expect(resultado).toBeInstanceOf(TypeError);
            expect(resultado).toHaveProperty("cause", expect.anything());

            expect(await contagens()).toStrictEqual({ chamados: 1, eventos: 1, registros: 1 });
        });

        it("a repetição com a mesma chave devolve o chamado gravado, sem nova gravação", async () => {
            expect(await postSemResposta(draft)).toBeInstanceOf(TypeError);
            const [gravado] = await db.prisma.ticket.findMany();
            expect(gravado).toBeDefined();

            const resposta = await post(draft);

            expect(resposta.status).toBe(201);
            expect(await resposta.json()).toMatchObject({ id: gravado?.id });
            expect(await contagens()).toStrictEqual({ chamados: 1, eventos: 1, registros: 1 });
            expect(await ultimoNumeroInc()).toBe(1);
        });

        it("requisição inválida não consome a falha", async () => {
            const invalida = await post(draftInvalido);
            expect(invalida.status).toBe(400);

            const resultado = await postSemResposta(draft);

            expect(resultado).toBeInstanceOf(TypeError);
            expect(await contagens()).toStrictEqual({ chamados: 1, eventos: 1, registros: 1 });
        });

        it("rejeição de negócio não consome a falha", async () => {
            const rejeitada = await post(draftPrioridadeDivergente);
            expect(rejeitada.status).toBe(422);
            expect(await contagens()).toStrictEqual({ chamados: 0, eventos: 0, registros: 0 });

            const resultado = await postSemResposta(draft);

            expect(resultado).toBeInstanceOf(TypeError);
            expect(await contagens()).toStrictEqual({ chamados: 1, eventos: 1, registros: 1 });
        });
    });

    describe("F-DROP-BEFORE", () => {
        beforeEach(async () => {
            await ligar({ mode: "F-DROP-BEFORE" });
        });

        it("não grava nada e encerra a conexão sem resposta HTTP", async () => {
            const resultado = await postSemResposta(draft);

            expect(resultado).toBeInstanceOf(TypeError);
            expect(resultado).toHaveProperty("cause", expect.anything());

            expect(await contagens()).toStrictEqual({ chamados: 0, eventos: 0, registros: 0 });
        });

        it("a repetição com a mesma chave cria o chamado", async () => {
            expect(await postSemResposta(draft)).toBeInstanceOf(TypeError);

            const resposta = await post(draft);

            expect(resposta.status).toBe(201);
            const [criado] = await db.prisma.ticket.findMany();
            expect(criado).toBeDefined();
            expect(await resposta.json()).toMatchObject({ id: criado?.id });
            expect(await contagens()).toStrictEqual({ chamados: 1, eventos: 1, registros: 1 });
            expect(await ultimoNumeroInc()).toBe(1);
        });

        it("requisição inválida não consome a falha", async () => {
            const invalida = await post(draftInvalido);
            expect(invalida.status).toBe(400);

            const resultado = await postSemResposta(draft);

            expect(resultado).toBeInstanceOf(TypeError);
            expect(await contagens()).toStrictEqual({ chamados: 0, eventos: 0, registros: 0 });
        });

        // FS2: a falha age antes do caso de uso; a regra de negócio nunca é avaliada.
        it("rejeição de negócio consome a falha sem chegar ao caso de uso", async () => {
            const resultado = await postSemResposta(draftPrioridadeDivergente);

            expect(resultado).toBeInstanceOf(TypeError);
            expect(await contagens()).toStrictEqual({ chamados: 0, eventos: 0, registros: 0 });

            const valida = await post(draft);

            expect(valida.status).toBe(201);
            expect(await contagens()).toStrictEqual({ chamados: 1, eventos: 1, registros: 1 });
        });
    });
});
