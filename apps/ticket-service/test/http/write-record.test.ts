
import { describe, expect, it } from "vitest";

import type { CreateTicketInput, CreateTicketResult } from "../../src/application/create-ticket.js";
import type { CreateTicketDraft, Ticket } from "../../src/domain/index.js";
import { createApp } from "../../src/http/app.js";
import type { WriteRecord } from "../../src/http/write-record.js";

// Cenários §1.1: um registro por requisição de escrita, emitido pela camada HTTP.
// Testes de rota sem porta (ADR-010, condição 2); o caso de uso é um double.

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

function validHeaders(): Record<string, string> {
    return {
        "Content-Type": "application/json",
        "Idempotency-Key": IDEMPOTENCY_KEY,
        "X-Actor-Type": "EMPLOYEE",
        "X-Actor-Employee-Id": "EMP-001",
    };
}

// Monta o app com um double do caso de uso e um coletor dos registros.
function montar(
    resposta: CreateTicketResult | Error,
    recordWrite?: (record: WriteRecord) => void,
) {
    const chamadas: CreateTicketInput[] = [];
    const registros: WriteRecord[] = [];

    const app = createApp({
        createTicket: {
            execute: async (input: CreateTicketInput): Promise<CreateTicketResult> => {
                chamadas.push(input);
                if (resposta instanceof Error) throw resposta;
                return resposta;
            },
        },
        // Silencia o registro do 500 nos casos de ERROR.
        onUnexpectedError: () => {},
        recordWrite: recordWrite ?? ((record) => {
            registros.push(record);
        }),
    });

    return { app, chamadas, registros };
}

function postTickets(
    app: ReturnType<typeof createApp>,
    headers: Record<string, string> = validHeaders(),
    body: unknown = draft,
) {
    return app.request("/tickets", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });
}

describe("registro das escritas (POST /tickets)", () => {
    // IN4, IN7. A igualdade estrita prova que não há corpo, snapshot nem id de funcionário (IN6).
    it.each(["CREATED", "REPLAYED"] as const)(
        "registra %s com 201, chave, ticketId e SENT",
        async (outcome) => {
            const { app, registros } = montar({ ok: true, outcome, ticket });

            const response = await postTickets(app);

            expect(response.status).toBe(201);
            expect(await response.json()).toStrictEqual(ticket);
            expect(registros).toStrictEqual([
                {
                    event: "ticket_write",
                    operation: "CREATE",
                    outcome,
                    status: 201,
                    idempotencyKey: IDEMPOTENCY_KEY,
                    ticketId: ticket.id,
                    responseDisposition: "SENT",
                },
            ]);
        },
    );

    // Contrato HTTP §4.1: rejeições do caso de uso.
    it.each([
        ["ACTOR_NOT_EMPLOYEE", 403],
        ["IDEMPOTENCY_KEY_CONFLICT", 409],
        ["INVALID_IMPACT_ASSESSMENT", 422],
        ["PRIORITY_MISMATCH", 422],
    ] as const)("registra REJECTED com %s (%i), sem ticketId", async (error, status) => {
        const { app, registros } = montar({ ok: false, error });

        const response = await postTickets(app);

        expect(response.status).toBe(status);
        expect(registros).toStrictEqual([
            {
                event: "ticket_write",
                operation: "CREATE",
                outcome: "REJECTED",
                status,
                code: error,
                idempotencyKey: IDEMPOTENCY_KEY,
                responseDisposition: "SENT",
            },
        ]);
    });

    // Contrato HTTP §2 e §4.1: rejeições da validação de forma, antes do caso de uso.
    describe("INVALID", () => {
        it("corpo com campo extra: 400 VALIDATION_ERROR, com a chave", async () => {
            const { app, chamadas, registros } = montar({ ok: true, outcome: "CREATED", ticket });

            const response = await postTickets(app, validHeaders(), {
                ...draft,
                requesterId: "EMP-999",
            });

            expect(response.status).toBe(400);
            expect(chamadas).toStrictEqual([]);
            expect(registros).toStrictEqual([
                {
                    event: "ticket_write",
                    operation: "CREATE",
                    outcome: "INVALID",
                    status: 400,
                    code: "VALIDATION_ERROR",
                    idempotencyKey: IDEMPOTENCY_KEY,
                    responseDisposition: "SENT",
                },
            ]);
        });

        it("chave malformada: 400 VALIDATION_ERROR, sem o campo idempotencyKey", async () => {
            const { app, chamadas, registros } = montar({ ok: true, outcome: "CREATED", ticket });

            const response = await postTickets(app, {
                ...validHeaders(),
                "Idempotency-Key": "abc",
            });

            expect(response.status).toBe(400);
            expect(chamadas).toStrictEqual([]);
            // IN4: o valor inválido recebido nunca é registrado.
            expect(registros).toStrictEqual([
                {
                    event: "ticket_write",
                    operation: "CREATE",
                    outcome: "INVALID",
                    status: 400,
                    code: "VALIDATION_ERROR",
                    responseDisposition: "SENT",
                },
            ]);
        });

        // IN4: a chave válida entra mesmo quando o Content-Type é recusado antes da
        // validação dos cabeçalhos (não depende da ordem dos validadores).
        it("Content-Type errado: 415 UNSUPPORTED_MEDIA_TYPE, com a chave válida", async () => {
            const { app, chamadas, registros } = montar({ ok: true, outcome: "CREATED", ticket });

            const response = await postTickets(app, {
                ...validHeaders(),
                "Content-Type": "text/plain",
            });

            expect(response.status).toBe(415);
            expect(chamadas).toStrictEqual([]);
            expect(registros).toStrictEqual([
                {
                    event: "ticket_write",
                    operation: "CREATE",
                    outcome: "INVALID",
                    status: 415,
                    code: "UNSUPPORTED_MEDIA_TYPE",
                    idempotencyKey: IDEMPOTENCY_KEY,
                    responseDisposition: "SENT",
                },
            ]);
        });
    });

    // Contrato HTTP §4.3: exceção não mapeada.
    it("registra ERROR com 500 INTERNAL_ERROR quando o caso de uso lança", async () => {
        const { app, registros } = montar(new Error("falha simulada no banco"));

        const response = await postTickets(app);

        expect(response.status).toBe(500);
        expect(registros).toStrictEqual([
            {
                event: "ticket_write",
                operation: "CREATE",
                outcome: "ERROR",
                status: 500,
                code: "INTERNAL_ERROR",
                idempotencyKey: IDEMPOTENCY_KEY,
                responseDisposition: "SENT",
            },
        ]);
    });

    // IN3: só rotas de escrita. O mesmo caminho com outro método também não é escrita.
    it.each([
        ["GET", "/tickets"],
        ["POST", "/outra-rota"],
    ] as const)("não registra %s %s", async (method, path) => {
        const { app, chamadas, registros } = montar({ ok: true, outcome: "CREATED", ticket });

        await app.request(path, {
            method,
            headers: validHeaders(),
            ...(method === "POST" ? { body: JSON.stringify(draft) } : {}),
        });

        expect(chamadas).toStrictEqual([]);
        expect(registros).toStrictEqual([]);
    });

    // IN8: falha do gravador nunca altera a resposta nem o resultado de negócio.
    // Passa antes da implementação (sem gravador, nada quebra); fica como proteção.
    it("gravador que lança não altera a resposta", async () => {
        const { app, chamadas } = montar({ ok: true, outcome: "CREATED", ticket }, () => {
            throw new Error("gravador quebrado");
        });

        const response = await postTickets(app);

        expect(response.status).toBe(201);
        expect(await response.json()).toStrictEqual(ticket);
        expect(chamadas).toHaveLength(1);
    });
});
