import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { markRead, readRecorder, type ReadEnv } from "../../src/http/app.js";
import type { ReadOperation, ReadRecord } from "../../src/http/read-record.js";
import { createErrorLogger } from "../../src/observability/error-log.js";

// Cenários §1.1, IL1–IL7: o emissor do ticket_read isolado, num app mínimo, como o
// write-recorder.test.ts. "Exatamente uma emissão" vale para os caminhos classificados;
// a falta de marca é defeito interno: vai ao onUnexpectedError e não gera ticket_read
// (plano da fatia 0, D4).

type Marca = Parameters<typeof markRead>[1];

interface Montagem {
    operation: ReadOperation;
    marca?: Marca;
    recordRead?: (record: ReadRecord) => void;
    onUnexpectedError?: (error: unknown) => void;
}

function montar({ operation, marca, recordRead, onUnexpectedError = () => {} }: Montagem) {
    const registros: ReadRecord[] = [];

    const app = new Hono<ReadEnv>();
    app.get(
        "/leitura",
        readRecorder({
            operation,
            recordRead:
                recordRead ??
                ((record) => {
                    registros.push(record);
                }),
            onUnexpectedError,
        }),
        (c) => {
            if (marca !== undefined) markRead(c, marca);
            return c.json({ resposta: "do handler" }, 200);
        },
    );

    return { app, registros };
}

// O onUnexpectedError composto como no main.ts (tabela do P1: context "request"), com o
// stderr capturado. O mockRestore limpa as chamadas: a saída é lida antes de restaurar.
async function comStderr<T>(acao: () => T | Promise<T>): Promise<{ resultado: T; linhas: Record<string, unknown>[] }> {
    const escrita = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let resultado: T;
    let stderr: string;
    try {
        resultado = await acao();
    } finally {
        stderr = escrita.mock.calls.map(([trecho]) => String(trecho)).join("");
        escrita.mockRestore();
    }
    const linhas = stderr
        .split("\n")
        .filter((linha) => linha.includes('"unexpected_error"'))
        .map((linha) => JSON.parse(linha) as Record<string, unknown>);
    return { resultado, linhas };
}

describe("readRecorder (emissor isolado)", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("um registro por requisição, com event ticket_read, operation da rota e SENT", async () => {
        const { app, registros } = montar({ operation: "LIST", marca: { outcome: "OK", status: 200 } });

        await app.request("/leitura");
        await app.request("/leitura");

        const esperado: ReadRecord = {
            event: "ticket_read",
            operation: "LIST",
            outcome: "OK",
            status: 200,
            responseDisposition: "SENT",
        };
        expect(registros).toStrictEqual([esperado, esperado]);
    });

    it("operation vem da rota: VIEW", async () => {
        const { app, registros } = montar({ operation: "VIEW", marca: { outcome: "OK", status: 200 } });

        await app.request("/leitura");

        expect(registros.map((registro) => registro.operation)).toStrictEqual(["VIEW"]);
    });

    it("ticketId só quando a rota o marca", async () => {
        const comId = montar({ operation: "VIEW", marca: { outcome: "OK", status: 200, ticketId: "INC-1" } });
        const semId = montar({
            operation: "VIEW",
            marca: { outcome: "REJECTED", status: 404, code: "TICKET_NOT_FOUND" },
        });

        await comId.app.request("/leitura");
        await semId.app.request("/leitura");

        expect(comId.registros).toStrictEqual([
            {
                event: "ticket_read",
                operation: "VIEW",
                outcome: "OK",
                status: 200,
                ticketId: "INC-1",
                responseDisposition: "SENT",
            },
        ]);
        expect(semId.registros).toStrictEqual([
            {
                event: "ticket_read",
                operation: "VIEW",
                outcome: "REJECTED",
                status: 404,
                code: "TICKET_NOT_FOUND",
                responseDisposition: "SENT",
            },
        ]);
    });

    it("nunca registra idempotencyKey nem id de funcionário", async () => {
        const { app, registros } = montar({ operation: "LIST", marca: { outcome: "OK", status: 200 } });

        await app.request("/leitura", {
            headers: {
                "Idempotency-Key": "00000000-0000-4000-8000-000000000001",
                "X-Actor-Type": "EMPLOYEE",
                "X-Actor-Employee-Id": "EMP-001",
            },
        });

        expect(registros).toHaveLength(1);
        expect(registros[0]).not.toHaveProperty("idempotencyKey");
        expect(JSON.stringify(registros)).not.toContain("EMP-001");
        expect(JSON.stringify(registros)).not.toContain("00000000-0000-4000-8000-000000000001");
    });

    it("gravador que lança: resposta intacta, uma única tentativa e o defeito uma vez no onUnexpectedError", async () => {
        const falhaDoGravador = new Error("gravador quebrado");
        const tentativas: ReadRecord[] = [];
        const erros: unknown[] = [];
        const logError = createErrorLogger();
        const { app } = montar({
            operation: "LIST",
            marca: { outcome: "OK", status: 200 },
            recordRead: (record) => {
                tentativas.push(record);
                throw falhaDoGravador;
            },
            onUnexpectedError: (error) => {
                erros.push(error);
                logError("request", error);
            },
        });

        const { resultado: response, linhas } = await comStderr(() => app.request("/leitura"));

        expect(response.status).toBe(200);
        expect(await response.json()).toStrictEqual({ resposta: "do handler" });
        expect(tentativas).toHaveLength(1);
        expect(erros).toStrictEqual([falhaDoGravador]);
        expect(linhas).toHaveLength(1);
        expect(linhas[0]).toMatchObject({ event: "unexpected_error", context: "request" });
    });

    it("caminho sem marca: nenhum ticket_read, resposta intacta e o defeito uma vez no onUnexpectedError", async () => {
        const erros: unknown[] = [];
        const logError = createErrorLogger();
        const { app, registros } = montar({
            operation: "VIEW",
            onUnexpectedError: (error) => {
                erros.push(error);
                logError("request", error);
            },
        });

        const { resultado: response, linhas } = await comStderr(() => app.request("/leitura"));

        expect(response.status).toBe(200);
        expect(await response.json()).toStrictEqual({ resposta: "do handler" });
        expect(registros).toStrictEqual([]);
        expect(erros).toHaveLength(1);
        expect(erros[0]).toBeInstanceOf(Error);
        expect(erros[0]).toMatchObject({ message: expect.stringContaining("sem desfecho registrado") });
        expect(linhas).toHaveLength(1);
        expect(linhas[0]).toMatchObject({ event: "unexpected_error", context: "request" });
    });

    it("onUnexpectedError que lança não altera a resposta do caminho sem marca", async () => {
        const { app, registros } = montar({
            operation: "LIST",
            onUnexpectedError: () => {
                throw new Error("diagnóstico quebrado");
            },
        });

        const response = await app.request("/leitura");

        expect(response.status).toBe(200);
        expect(await response.json()).toStrictEqual({ resposta: "do handler" });
        expect(registros).toStrictEqual([]);
    });
});
