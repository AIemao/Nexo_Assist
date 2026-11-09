
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { markWrite, writeRecorder, type WriteEnv } from "../../src/http/app.js";
import type { WriteRecord } from "../../src/http/write-record.js";

// Cenários §1.1, IN8: o emissor isolado, num app mínimo cuja rota responde sem marcar o
// desfecho. Na rota real todo caminho marca; aqui se prova o que acontece se um caminho
// futuro esquecer: nenhum desfecho inventado, mas o defeito aparece no onUnexpectedError.

function montar(onUnexpectedError: (error: unknown) => void) {
    const registros: WriteRecord[] = [];

    const app = new Hono();
    app.post(
        "/escrita",
        writeRecorder({
            recordWrite: (record) => {
                registros.push(record);
            },
            onUnexpectedError,
        }),
        (c) => c.json({ resposta: "do handler" }, 201),
    );

    return { app, registros };
}

describe("writeRecorder (emissor isolado)", () => {
    it("caminho sem desfecho marcado: não registra, avisa uma vez e preserva a resposta", async () => {
        const erros: unknown[] = [];
        const { app, registros } = montar((error) => {
            erros.push(error);
        });

        const response = await app.request("/escrita", { method: "POST" });

        expect(response.status).toBe(201);
        expect(await response.json()).toStrictEqual({ resposta: "do handler" });
        expect(registros).toStrictEqual([]);
        expect(erros).toHaveLength(1);
        expect(erros[0]).toBeInstanceOf(Error);
        expect(erros[0]).toMatchObject({
            message: expect.stringContaining("sem desfecho registrado"),
        });
    });

    // Mesma proteção do onError: o diagnóstico nunca vira 500 numa escrita já respondida.
    it("onUnexpectedError que lança não altera a resposta", async () => {
        const { app, registros } = montar(() => {
            throw new Error("diagnóstico quebrado");
        });

        const response = await app.request("/escrita", { method: "POST" });

        expect(response.status).toBe(201);
        expect(await response.json()).toStrictEqual({ resposta: "do handler" });
        expect(registros).toStrictEqual([]);
    });

    // IN8: falha do gravador nunca altera a resposta; o erro vai para o registro interno
    // e nenhum segundo registro é emitido. A rota marca pelo mesmo mecanismo do app real.
    it("gravador que lança: resposta intacta, erro no onUnexpectedError e uma única tentativa", async () => {
        const falhaDoGravador = new Error("gravador quebrado");
        const tentativas: WriteRecord[] = [];
        const erros: unknown[] = [];

        const app = new Hono<WriteEnv>();
        app.post(
            "/escrita",
            writeRecorder({
                recordWrite: (record) => {
                    tentativas.push(record);
                    throw falhaDoGravador;
                },
                onUnexpectedError: (error) => {
                    erros.push(error);
                },
            }),
            (c) => {
                markWrite(c, {
                    outcome: "CREATED",
                    status: 201,
                    ticketId: "INC-1",
                    responseDisposition: "SENT",
                });
                return c.json({ resposta: "do handler" }, 201);
            },
        );

        const response = await app.request("/escrita", { method: "POST" });

        expect(response.status).toBe(201);
        expect(await response.json()).toStrictEqual({ resposta: "do handler" });
        expect(tentativas).toStrictEqual([
            {
                event: "ticket_write",
                operation: "CREATE",
                outcome: "CREATED",
                status: 201,
                ticketId: "INC-1",
                responseDisposition: "SENT",
            },
        ]);
        expect(erros).toHaveLength(1);
        expect(erros[0]).toBe(falhaDoGravador);
    });
});
