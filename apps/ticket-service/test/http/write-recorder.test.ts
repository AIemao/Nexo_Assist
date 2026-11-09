
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { writeRecorder } from "../../src/http/app.js";
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
});
