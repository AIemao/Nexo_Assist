
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import type {
    Actor,
    CreateTicketDraft,
    Ticket,
} from "../../src/domain/index.js";

import { createCreateTicket } from "../../src/application/create-ticket.js";
import { computeDueAt } from "../../src/domain/index.js";
import { Prisma } from "../../src/generated/prisma/client.js";
import { createApp } from "../../src/http/app.js";
import type { WriteRecord } from "../../src/http/write-record.js";
import { createErrorLogger } from "../../src/observability/error-log.js";
import { readPrismaCode } from "../../src/persistence/prisma-error-code.js";
import { createUnitOfWork } from "../../src/persistence/unit-of-work.js";
import { createTestDatabase } from "../support/test-database.js";

const NOW = "2026-11-07T12:00:00.000Z";

const IDEMPOTENCY_KEY =
    "00000000-0000-4000-8000-000000000001";

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

const actor = {
    type: "EMPLOYEE",
    employeeId: "EMP-001",
} satisfies Actor;

const ticket: Ticket = {
    id: "INC-1",
    version: 1,
    type: "INC",
    title: "Notebook lento",
    description: "Notebook apresenta lentidão após atualização.",
    category: "HARDWARE",
    priority: "LOW",
    status: "WAITING_ANALYST",
    requesterId: "EMP-001",
    impactAssessment: {
        workImpact: "NONE",
        affectedScope: "SELF",
        commitmentRisk: "NO",
    },
    createdAt: NOW,
    updatedAt: NOW,
    firstResponseDueAt: "2026-11-09T12:00:00.000Z",
};

type CreateTicketUseCase = ReturnType<typeof createCreateTicket>;

type CreateTicketInput = Parameters<
    CreateTicketUseCase["execute"]
>[0];

type CreateTicketResult = Awaited<
    ReturnType<CreateTicketUseCase["execute"]>
>;

interface ProblemDetails {
    type?: string;
    title?: string;
    status?: number;
    code?: string;
    errors?: Array<{
        path: string;
        message: string;
    }>;
}

interface InvalidRequest {
    name: string;
    headers: Record<string, string>;
    body: object;
    expectedPath: string;
}

const resultadoSucesso: CreateTicketResult = {
    ok: true,
    outcome: "CREATED",
    ticket,
};

function criarCreateTicketFalso(
    resposta: CreateTicketResult | Error,
) {
    const chamadas: CreateTicketInput[] = [];

    return {
        chamadas,
        createTicket: {
            execute: async (
                input: CreateTicketInput,
            ): Promise<CreateTicketResult> => {
                chamadas.push(input);

                if (resposta instanceof Error) {
                    throw resposta;
                }

                return resposta;
            },
        },
    };
}

function validHeaders(): Record<string, string> {
    return {
        "Content-Type": "application/json",
        "Idempotency-Key": IDEMPOTENCY_KEY,
        "X-Actor-Type": "EMPLOYEE",
        "X-Actor-Employee-Id": "EMP-001",
    };
}

function headersWithout(...names: string[]): Record<string, string> {
    const headers = validHeaders();

    for (const name of names) {
        delete headers[name];
    }

    return headers;
}

function serialize(body: object): string {
    const serialized = JSON.stringify(body);

    if (serialized === undefined) {
        throw new Error("Não foi possível serializar o corpo do teste.");
    }

    return serialized;
}

const TITULOS: Record<number, string> = {
    400: "Bad Request",
    403: "Forbidden",
    409: "Conflict",
    415: "Unsupported Media Type",
    422: "Unprocessable Content",
    500: "Internal Server Error",
};

async function expectProblem(
    response: Response,
    status: number,
    code: string,
): Promise<ProblemDetails> {
    expect(response.status).toBe(status);

    expect(
        response.headers.get("content-type")?.split(";")[0],
    ).toBe("application/problem+json");

    const problem = await response.json() as ProblemDetails;

    expect(problem).toMatchObject({
        type: "about:blank",
        title: TITULOS[status],
        status,
        code,
    });

    return problem;
}

describe("POST /tickets", () => {
    let db: Awaited<ReturnType<typeof createTestDatabase>>;
    let unitOfWork: ReturnType<typeof createUnitOfWork>;

    beforeAll(async () => {
        db = await createTestDatabase();
        unitOfWork = createUnitOfWork(db.prisma);
    });

    afterAll(async () => {
        await db.dispose();
    });

    // Cenário 1: verifica a entrada do caso de uso e o formato HTTP de sucesso.
    it("recebe os dados corretos e devolve somente o ticket com HTTP 201", async () => {
        const fake = criarCreateTicketFalso(resultadoSucesso);
        const app = createApp({ createTicket: fake.createTicket });

        const response = await app.request("/tickets", {
            method: "POST",
            headers: validHeaders(),
            body: serialize(draft),
        });

        expect(response.status).toBe(201);

        const responseBody = await response.json();

        expect(responseBody).toStrictEqual(ticket);
        expect(responseBody).not.toHaveProperty("ok");

        expect(fake.chamadas).toStrictEqual([
            {
                idempotencyKey: IDEMPOTENCY_KEY,
                draft,
                actor,
            },
        ]);
    });

    const invalidRequests: InvalidRequest[] = [
        {
            name: "sem Idempotency-Key",
            headers: headersWithout("Idempotency-Key"),
            body: draft,
            expectedPath: "Idempotency-Key",
        },
        {
            name: "chave que não é UUID",
            headers: {
                ...validHeaders(),
                "Idempotency-Key": "not-a-uuid",
            },
            body: draft,
            expectedPath: "Idempotency-Key",
        },
        {
            name: "chave entre aspas",
            headers: {
                ...validHeaders(),
                "Idempotency-Key": `"${IDEMPOTENCY_KEY}"`,
            },
            body: draft,
            expectedPath: "Idempotency-Key",
        },
        {
            name: "sem X-Actor-Type",
            headers: headersWithout("X-Actor-Type"),
            body: draft,
            expectedPath: "X-Actor-Type",
        },
        {
            name: "EMPLOYEE sem X-Actor-Employee-Id",
            headers: headersWithout("X-Actor-Employee-Id"),
            body: draft,
            expectedPath: "X-Actor-Employee-Id",
        },
        {
            name: "SYSTEM com X-Actor-Employee-Id",
            headers: {
                ...validHeaders(),
                "X-Actor-Type": "SYSTEM",
            },
            body: draft,
            expectedPath: "X-Actor-Employee-Id",
        },
        {
            name: "cabeçalho X-ACTOR-Foo não previsto",
            headers: {
                ...validHeaders(),
                "X-ACTOR-Foo": "unexpected",
            },
            body: draft,
            expectedPath: "x-actor-foo",
        },
        {
            name: "requesterId adicional no corpo",
            headers: validHeaders(),
            body: {
                ...draft,
                requesterId: "EMP-999",
            },
            expectedPath: "#/requesterId",
        },
        {
            name: "título vazio",
            headers: validHeaders(),
            body: {
                ...draft,
                title: "",
            },
            expectedPath: "#/title",
        },
        {
            name: "category fora do catálogo",
            headers: validHeaders(),
            body: {
                ...draft,
                category: "PRINTER",
            },
            expectedPath: "#/category",
        },
    ];

    // Cenário 2: validações da fronteira devem rejeitar antes do caso de uso.
    it.each(invalidRequests)(
        "rejeita com 400: $name",
        async ({
            headers,
            body,
            expectedPath,
        }) => {
            const fake = criarCreateTicketFalso(resultadoSucesso);
            const app = createApp({ createTicket: fake.createTicket });

            const response = await app.request("/tickets", {
                method: "POST",
                headers,
                body: serialize(body),
            });

            const problem = await expectProblem(
                response,
                400,
                "VALIDATION_ERROR",
            );

            const paths = problem.errors?.map((error) => error.path) ?? [];

            const normalizarPath = (path: string) =>
                path.startsWith("#/") ? path : path.toLowerCase();

            expect(paths.map(normalizarPath)).toContain(
                normalizarPath(expectedPath),
            );

            expect(fake.chamadas).toStrictEqual([]);
        },
    );

    // Cenário 3: Content-Type ausente ou incompatível deve resultar em 415.
    it.each([
        {
            name: "sem Content-Type",
            headers: headersWithout("Content-Type"),
        },
        {
            name: "Content-Type text/plain",
            headers: {
                ...validHeaders(),
                "Content-Type": "text/plain",
            },
        },
    ])(
        "rejeita com 415: $name",
        async ({ headers }) => {
            const fake = criarCreateTicketFalso(resultadoSucesso);
            const app = createApp({ createTicket: fake.createTicket });

            const response = await app.request("/tickets", {
                method: "POST",
                headers,
                body: new Blob([serialize(draft)]),
            });

            await expectProblem(
                response,
                415,
                "UNSUPPORTED_MEDIA_TYPE",
            );

            expect(fake.chamadas).toStrictEqual([]);
        },
    );

    // Cenário 4: mapeia os resultados de rejeição do caso de uso.
    it.each([
        {
            error: "ACTOR_NOT_EMPLOYEE",
            status: 403,
        },
        {
            error: "IDEMPOTENCY_KEY_CONFLICT",
            status: 409,
        },
        {
            error: "INVALID_IMPACT_ASSESSMENT",
            status: 422,
        },
        {
            error: "PRIORITY_MISMATCH",
            status: 422,
        },
    ] as const)(
        "mapeia $error para HTTP $status",
        async ({ error, status }) => {
            const fake = criarCreateTicketFalso({
                ok: false,
                error,
            });

            const app = createApp({ createTicket: fake.createTicket });

            const response = await app.request("/tickets", {
                method: "POST",
                headers: validHeaders(),
                body: serialize(draft),
            });

            const problem = await expectProblem(response, status, error);

            expect(problem.errors).toBeUndefined();
            expect(fake.chamadas).toHaveLength(1);
        },
    );

    // Cenário 5: nenhuma informação interna pode escapar na resposta 500.
    it("devolve 500 genérico sem expor detalhes da exceção", async () => {
        const fake = criarCreateTicketFalso(
            new Error("detalhe interno: SELECT * FROM Ticket"),
        );

        const app = createApp({ createTicket: fake.createTicket });

        const response = await app.request("/tickets", {
            method: "POST",
            headers: validHeaders(),
            body: serialize(draft),
        });

        const responseText = await response.text();

        expect(response.status).toBe(500);

        expect(
            response.headers.get("content-type")?.split(";")[0],
        ).toBe("application/problem+json");

        const problem = JSON.parse(responseText) as ProblemDetails;

        expect(problem).toMatchObject({
            type: "about:blank",
            title: "Internal Server Error",
            status: 500,
            code: "INTERNAL_ERROR",
        });

        expect(responseText).not.toContain("SELECT");
        expect(responseText).not.toContain("detalhe interno");
        expect(responseText).not.toContain("stack");

        expect(fake.chamadas).toHaveLength(1);
    });

    // Cenário 6: usa o caso de uso real e verifica a reconciliação pelo banco.
    it("cria e reconcilia o chamado pela mesma chave com o banco real", async () => {
        await db.reset();
        // O ator é EMP-001 (FK de requesterId e actorEmployeeId).
        await db.createEmployees("EMP-001");

        const eventIdGenerator = {
            generate: () => "EVT-HTTP-001",
        };

        const clock = {
            now: () => NOW,
        };

        const createTicket = createCreateTicket({
            unitOfWork,
            eventIdGenerator,
            clock,
        });

        const app = createApp({ createTicket });

        const firstResponse = await app.request("/tickets", {
            method: "POST",
            headers: validHeaders(),
            body: serialize(draft),
        });

        const secondResponse = await app.request("/tickets", {
            method: "POST",
            headers: validHeaders(),
            body: serialize(draft),
        });

        expect(firstResponse.status).toBe(201);
        expect(secondResponse.status).toBe(201);

        const firstBody = await firstResponse.json();
        const secondBody = await secondResponse.json();

        expect(firstBody).toStrictEqual(secondBody);
        expect(firstBody).toMatchObject({
            id: "INC-1",
            version: 1,
            type: "INC",
            priority: "LOW",
            status: "WAITING_ANALYST",
            requesterId: "EMP-001",
            createdAt: NOW,
            updatedAt: NOW,
            firstResponseDueAt: computeDueAt(NOW, "LOW"),
        });

        expect(firstBody).not.toHaveProperty("ok");

        const [tickets, events, records] = await Promise.all([
            db.prisma.ticket.findMany(),
            db.prisma.ticketEvent.findMany(),
            db.prisma.idempotencyRecord.findMany(),
        ]);

        expect(tickets).toHaveLength(1);
        expect(events).toHaveLength(1);
        expect(records).toHaveLength(1);

        expect(events[0]).toMatchObject({
            id: "EVT-HTTP-001",
            ticketId: "INC-1",
            type: "CREATED",
            actorType: "EMPLOYEE",
            actorEmployeeId: "EMP-001",
            summary: "Chamado criado",
        });

        expect(records[0]).toMatchObject({
            key: IDEMPOTENCY_KEY,
            operationType: "CREATE",
            ticketId: "INC-1",
        });
    });

    // Cenário 7: o media type é comparado sem os parâmetros, com ou sem espaço antes do ";".
    it.each([
        "application/json; charset=utf-8",
        "application/json ; charset=utf-8",
    ])(
        "aceita Content-Type %s",
        async (contentType) => {
            const fake = criarCreateTicketFalso(resultadoSucesso);
            const app = createApp({ createTicket: fake.createTicket });

            const response = await app.request("/tickets", {
                method: "POST",
                headers: {
                    ...validHeaders(),
                    "Content-Type": contentType,
                },
                body: serialize(draft),
            });

            expect(response.status).toBe(201);

            expect(fake.chamadas).toStrictEqual([
                {
                    idempotencyKey: IDEMPOTENCY_KEY,
                    draft,
                    actor,
                },
            ]);
        },
    );

    // Cenário 8: JSON malformado é erro de validação na raiz do corpo.
    it("rejeita corpo JSON malformado com 400 no caminho #", async () => {
        const fake = criarCreateTicketFalso(resultadoSucesso);
        const app = createApp({ createTicket: fake.createTicket });

        const response = await app.request("/tickets", {
            method: "POST",
            headers: validHeaders(),
            body: "{",
        });

        const problem = await expectProblem(
            response,
            400,
            "VALIDATION_ERROR",
        );

        expect(problem.errors?.[0]?.path).toBe("#");
        expect(fake.chamadas).toStrictEqual([]);
    });

    // Cenário 9: uma falha no registro interno não impede a resposta 500 genérica.
    it("devolve 500 genérico mesmo quando onUnexpectedError lança", async () => {
        const fake = criarCreateTicketFalso(
            new Error("detalhe interno: SELECT * FROM Ticket"),
        );

        const registrados: unknown[] = [];

        const app = createApp({
            createTicket: fake.createTicket,
            onUnexpectedError: (error) => {
                registrados.push(error);
                throw new Error("falha no logger");
            },
        });

        const response = await app.request("/tickets", {
            method: "POST",
            headers: validHeaders(),
            body: serialize(draft),
        });

        const responseText = await response.clone().text();

        await expectProblem(response, 500, "INTERNAL_ERROR");

        expect(responseText).not.toContain("detalhe interno");
        expect(responseText).not.toContain("falha no logger");

        expect(registrados).toHaveLength(1);
        expect(fake.chamadas).toHaveLength(1);
    });

    // Cenário 10: um registro assíncrono que rejeita não impede a resposta 500 genérica.
    it("devolve 500 genérico mesmo quando onUnexpectedError assíncrono rejeita", async () => {
        const fake = criarCreateTicketFalso(
            new Error("detalhe interno: SELECT * FROM Ticket"),
        );

        const registrados: unknown[] = [];

        const app = createApp({
            createTicket: fake.createTicket,
            onUnexpectedError: async (error) => {
                registrados.push(error);
                throw new Error("falha assíncrona no logger");
            },
        });

        const response = await app.request("/tickets", {
            method: "POST",
            headers: validHeaders(),
            body: serialize(draft),
        });

        const responseText = await response.clone().text();

        await expectProblem(response, 500, "INTERNAL_ERROR");

        expect(responseText).not.toContain("detalhe interno");
        expect(responseText).not.toContain("falha assíncrona no logger");

        expect(registrados).toHaveLength(1);
        expect(fake.chamadas).toHaveLength(1);
    });

    // README §12 #22: o 500 não leva ao stderr a mensagem, o meta nem as propriedades
    // próprias do erro; a linha traz context "request" (plano da fatia 0, D7).
    const EMAIL_PLANTADO = "ana@nexo.example";

    function erroDoPrismaComEmail(): Prisma.PrismaClientKnownRequestError {
        const erro = new Prisma.PrismaClientKnownRequestError(`falha ao consultar ${EMAIL_PLANTADO}`, {
            code: "P2003",
            clientVersion: "7.10.1",
            meta: { modelName: "Ticket", value: EMAIL_PLANTADO },
        });
        return Object.assign(erro, { emailConsultado: EMAIL_PLANTADO });
    }

    // Envia o POST com o stderr capturado e devolve a resposta, a saída e as linhas de erro.
    async function postComStderr(app: ReturnType<typeof createApp>) {
        // O mockRestore limpa as chamadas: a saída é lida antes de restaurar.
        const escrita = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        let response: Response;
        let stderr: string;
        try {
            response = await app.request("/tickets", {
                method: "POST",
                headers: validHeaders(),
                body: serialize(draft),
            });
        } finally {
            stderr = escrita.mock.calls.map(([trecho]) => String(trecho)).join("");
            escrita.mockRestore();
        }

        const linhas = stderr
            .split("\n")
            .filter((linha) => linha.includes('"unexpected_error"'))
            .map((linha) => JSON.parse(linha) as Record<string, unknown>);

        return { response, stderr, linhas };
    }

    it("500 com o registro da raiz de composição: stderr sem o e-mail, com context request e prismaCode", async () => {
        const fake = criarCreateTicketFalso(erroDoPrismaComEmail());
        const logError = createErrorLogger(readPrismaCode);
        const app = createApp({
            createTicket: fake.createTicket,
            onUnexpectedError: (error) => logError("request", error),
        });

        const { response, stderr, linhas } = await postComStderr(app);

        const responseText = await response.clone().text();
        await expectProblem(response, 500, "INTERNAL_ERROR");
        expect(responseText).not.toContain(EMAIL_PLANTADO);

        expect(stderr).not.toContain(EMAIL_PLANTADO);
        expect(linhas).toHaveLength(1);
        expect(linhas[0]).toMatchObject({
            event: "unexpected_error",
            context: "request",
            errorType: "PrismaClientKnownRequestError",
            prismaCode: "P2003",
        });
    });

    it("500 com o registro padrão do createApp: stderr sem o e-mail e sem prismaCode", async () => {
        const fake = criarCreateTicketFalso(erroDoPrismaComEmail());
        const app = createApp({ createTicket: fake.createTicket });

        const { response, stderr, linhas } = await postComStderr(app);

        await expectProblem(response, 500, "INTERNAL_ERROR");

        expect(stderr).not.toContain(EMAIL_PLANTADO);
        expect(linhas).toHaveLength(1);
        expect(linhas[0]).toMatchObject({
            event: "unexpected_error",
            context: "request",
            errorType: "PrismaClientKnownRequestError",
        });
        expect(linhas[0]).not.toHaveProperty("prismaCode");
    });

    // Contrato v1.3, nota do §4.3; ADR-008, atualização de 2026-11-21: com as FKs para
    // Employee, um X-Actor-Employee-Id sem Employee viola a premissa do README §8 e resulta no
    // 500 genérico, com ticket_write ERROR e rollback completo. O app usa o registro composto
    // como no main.ts (com o leitor do código do Prisma), não o padrão do createApp.
    it("ator sem Employee: 500 genérico, ticket_write ERROR, stderr só com campos permitidos e rollback completo", async () => {
        await db.reset();
        // Contador já existente: o rollback precisa preservar o valor, não só a ausência da linha.
        await db.prisma.ticketCounter.create({ data: { type: "INC", lastNumber: 7 } });

        const createTicket = createCreateTicket({
            unitOfWork,
            eventIdGenerator: { generate: () => "EVT-HTTP-404" },
            clock: { now: () => NOW },
        });
        const registros: WriteRecord[] = [];
        const logError = createErrorLogger(readPrismaCode);
        const app = createApp({
            createTicket,
            onUnexpectedError: (error) => logError("request", error),
            recordWrite: (record) => {
                registros.push(record);
            },
        });

        async function estadoDoBanco() {
            const contador = await db.prisma.ticketCounter.findUnique({ where: { type: "INC" } });
            return {
                ultimoNumeroInc: contador?.lastNumber ?? null,
                chamados: await db.prisma.ticket.count(),
                eventos: await db.prisma.ticketEvent.count(),
                registros: await db.prisma.idempotencyRecord.count(),
            };
        }

        const antes = await estadoDoBanco();

        // O mockRestore limpa as chamadas: a saída é lida antes de restaurar.
        const escrita = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        let response: Response;
        let stderr: string;
        try {
            response = await app.request("/tickets", {
                method: "POST",
                headers: { ...validHeaders(), "X-Actor-Employee-Id": "EMP-404" },
                body: serialize(draft),
            });
        } finally {
            stderr = escrita.mock.calls.map(([trecho]) => String(trecho)).join("");
            escrita.mockRestore();
        }

        const responseText = await response.clone().text();
        await expectProblem(response, 500, "INTERNAL_ERROR");
        expect(responseText).not.toContain("EMP-404");

        expect(registros).toStrictEqual([
            {
                event: "ticket_write",
                operation: "CREATE",
                outcome: "ERROR",
                status: 500,
                code: "INTERNAL_ERROR",
                responseDisposition: "SENT",
                idempotencyKey: IDEMPOTENCY_KEY,
            },
        ]);

        const linhas = stderr
            .split("\n")
            .filter((linha) => linha.includes('"unexpected_error"'))
            .map((linha) => JSON.parse(linha) as Record<string, unknown>);
        expect(linhas).toHaveLength(1);
        const { stack, ...semPilha } = linhas[0] ?? {};
        expect(semPilha).toStrictEqual({
            event: "unexpected_error",
            context: "request",
            errorType: "PrismaClientKnownRequestError",
            prismaCode: "P2003",
        });
        expect(Array.isArray(stack)).toBe(true);
        expect(stderr).not.toMatch(/foreign key/i);
        expect(stderr).not.toContain("EMP-404");

        expect(await estadoDoBanco()).toStrictEqual(antes);
    });

    // Contrato §2.2 e DM §3.9: SYSTEM não envia X-Actor-Employee-Id. O ator é estruturalmente
    // válido e não pode criar chamado: 403 ACTOR_NOT_EMPLOYEE pelo caso de uso real, sem gravar
    // nada. O caso com X-Actor-Employee-Id (400) é o "SYSTEM com X-Actor-Employee-Id" acima.
    it("ator SYSTEM sem X-Actor-Employee-Id: 403 ACTOR_NOT_EMPLOYEE, ticket_write REJECTED/403 e nada gravado", async () => {
        await db.reset();

        const createTicket = createCreateTicket({
            unitOfWork,
            eventIdGenerator: { generate: () => "EVT-HTTP-SYSTEM" },
            clock: { now: () => NOW },
        });
        const registros: WriteRecord[] = [];
        const app = createApp({
            createTicket,
            recordWrite: (record) => {
                registros.push(record);
            },
        });

        const response = await app.request("/tickets", {
            method: "POST",
            headers: { ...headersWithout("X-Actor-Employee-Id"), "X-Actor-Type": "SYSTEM" },
            body: serialize(draft),
        });

        await expectProblem(response, 403, "ACTOR_NOT_EMPLOYEE");
        expect(registros).toStrictEqual([
            {
                event: "ticket_write",
                operation: "CREATE",
                outcome: "REJECTED",
                status: 403,
                code: "ACTOR_NOT_EMPLOYEE",
                responseDisposition: "SENT",
                idempotencyKey: IDEMPOTENCY_KEY,
            },
        ]);
        expect({
            chamados: await db.prisma.ticket.count(),
            eventos: await db.prisma.ticketEvent.count(),
            registros: await db.prisma.idempotencyRecord.count(),
            contadores: await db.prisma.ticketCounter.count(),
        }).toStrictEqual({ chamados: 0, eventos: 0, registros: 0, contadores: 0 });
    });
});
