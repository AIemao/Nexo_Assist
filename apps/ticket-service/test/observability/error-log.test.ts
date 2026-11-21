import { afterEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "../../src/generated/prisma/client.js";
import {
    createErrorLogger,
    toErrorLogRecord,
    type ErrorLogContext,
    type PrismaCodeReader,
} from "../../src/observability/error-log.js";

// README §12 #22 (requisito da fatia 0 do Bloco 4): o registro de erros só usa campos
// permitidos. Formato (plano da fatia 0, D7): event, context, errorType, prismaCode?,
// systemCode? e stack. Nunca message, meta, cause nem propriedades arbitrárias.
// O código do Prisma vem de um leitor injetado; aqui, um leitor falso (o real está em
// test/persistence/prisma-error-code.test.ts).

const EMAIL = "ana@nexo.example";

const CAMPOS_PERMITIDOS = ["event", "context", "errorType", "prismaCode", "systemCode", "stack"];

function leitorFixo(code: string | undefined): PrismaCodeReader {
    return () => code;
}

function erroDoPrisma(code: string, message = "falha do Prisma"): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: "7.10.1" });
}

function comCodigo(code: unknown): Error {
    return Object.assign(new Error("falha de sistema"), { code });
}

describe("toErrorLogRecord", () => {
    it("Error comum: event, context, tipo e só os quadros da pilha", () => {
        const registro = toErrorLogRecord(new Error(`falha com ${EMAIL}`), "request");

        expect(registro).toMatchObject({ event: "unexpected_error", context: "request", errorType: "Error" });
        expect(registro.stack.length).toBeGreaterThan(0);
        for (const linha of registro.stack) {
            expect(linha).toMatch(/^at /);
        }
        expect(registro).not.toHaveProperty("prismaCode");
        expect(registro).not.toHaveProperty("systemCode");
        expect(JSON.stringify(registro)).not.toContain(EMAIL);
    });

    it("mensagem com quebra de linha não entra na pilha, nem uma linha que imita um quadro", () => {
        const erro = new Error(`primeira ${EMAIL}\nsegunda ${EMAIL}\n    at falso (${EMAIL})`);

        const registro = toErrorLogRecord(erro, "request");

        expect(registro.stack.length).toBeGreaterThan(0);
        expect(JSON.stringify(registro)).not.toContain(EMAIL);
    });

    it.each<ErrorLogContext>(["request", "server", "shutdown", "seed"])(
        "context sai igual ao literal recebido: %s",
        (context) => {
            expect(toErrorLogRecord(new Error("falha"), context).context).toBe(context);
        },
    );

    it("prismaCode vem do leitor injetado", () => {
        const registro = toErrorLogRecord(new Error("falha"), "request", leitorFixo("P2003"));

        expect(registro).toMatchObject({ errorType: "Error", prismaCode: "P2003" });
        expect(registro).not.toHaveProperty("systemCode");
    });

    it("leitor que devolve undefined: sem prismaCode", () => {
        const registro = toErrorLogRecord(erroDoPrisma("P2003"), "request", leitorFixo(undefined));

        expect(registro).not.toHaveProperty("prismaCode");
    });

    it("sem leitor, o erro do Prisma não ganha prismaCode", () => {
        const registro = toErrorLogRecord(erroDoPrisma("P2003"), "request");

        expect(registro).toMatchObject({ errorType: "PrismaClientKnownRequestError" });
        expect(registro).not.toHaveProperty("prismaCode");
        expect(registro).not.toHaveProperty("systemCode");
    });

    it("sem leitor, Error comum com code P2003 não ganha prismaCode nem systemCode", () => {
        const registro = toErrorLogRecord(comCodigo("P2003"), "request");

        expect(registro).not.toHaveProperty("prismaCode");
        expect(registro).not.toHaveProperty("systemCode");
    });

    it("erro de sistema do Node: systemCode quando o code casa com ^E[A-Z0-9_]+$", () => {
        const registro = toErrorLogRecord(comCodigo("EADDRINUSE"), "server");

        expect(registro).toMatchObject({ context: "server", systemCode: "EADDRINUSE" });
        expect(registro).not.toHaveProperty("prismaCode");
    });

    it.each<[string, unknown]>([
        ["e-mail", EMAIL],
        ["minúsculas", "eaddrinuse"],
        ["código do Prisma", "P2003"],
        ["só a letra E", "E"],
        ["número", 98],
        ["objeto", { code: "EADDRINUSE" }],
    ])("code que não é de sistema não vira systemCode: %s", (_nome, code) => {
        const registro = toErrorLogRecord(comCodigo(code), "server");

        expect(registro).not.toHaveProperty("systemCode");
        expect(JSON.stringify(registro)).not.toContain(EMAIL);
    });

    it.each<[string, unknown, string]>([
        ["string", `falha com ${EMAIL}`, "string"],
        ["objeto solto", { email: EMAIL }, "object"],
        ["undefined", undefined, "undefined"],
    ])("valor que não é Error (%s): só os campos estruturais obrigatórios, com stack: []", (_nome, valor, tipo) => {
        const registro = toErrorLogRecord(valor, "seed", leitorFixo("P2003"));

        expect(registro).toStrictEqual({ event: "unexpected_error", context: "seed", errorType: tipo, stack: [] });
    });

    it("tipo vem do nome do construtor", () => {
        class FalhaDeTeste extends Error {}

        expect(toErrorLogRecord(new FalhaDeTeste("x"), "request").errorType).toBe("FalhaDeTeste");
    });

    it("nome de construtor que não é identificador simples vira Error", () => {
        const erro = new Error("x");
        Object.defineProperty(erro, "constructor", { value: { name: EMAIL } });

        const registro = toErrorLogRecord(erro, "request");

        expect(registro.errorType).toBe("Error");
        expect(JSON.stringify(registro)).not.toContain(EMAIL);
    });

    it("message, meta, cause e propriedades próprias nunca aparecem", () => {
        const erro = new Prisma.PrismaClientKnownRequestError(`mensagem com ${EMAIL}`, {
            code: "P2002",
            clientVersion: "7.10.1",
            meta: { modelName: "Employee", target: EMAIL },
        });
        Object.assign(erro, { contato: EMAIL, cause: new Error(`causa com ${EMAIL}`) });

        const registro = toErrorLogRecord(erro, "request", leitorFixo("P2002"));

        for (const chave of Object.keys(registro)) {
            expect(CAMPOS_PERMITIDOS).toContain(chave);
        }
        expect(registro.prismaCode).toBe("P2002");
        expect(JSON.stringify(registro)).not.toContain(EMAIL);
    });
});

describe("createErrorLogger", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    function capturarStderr(): () => string {
        const escrita = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        return () => escrita.mock.calls.map(([trecho]) => String(trecho)).join("");
    }

    it("#22: e-mail plantado na mensagem, no meta e numa propriedade própria não chega ao stderr", () => {
        const lerStderr = capturarStderr();
        const erro = new Prisma.PrismaClientKnownRequestError(`Unique constraint failed for ${EMAIL}`, {
            code: "P2002",
            clientVersion: "7.10.1",
            meta: { modelName: "Employee", target: ["email"], value: EMAIL },
        });
        Object.assign(erro, { emailConsultado: EMAIL });

        createErrorLogger(leitorFixo("P2002"))("request", erro);

        const saida = lerStderr();
        expect(saida).not.toContain(EMAIL);
        expect(saida).toContain('"prismaCode":"P2002"');
    });

    it("sem leitor: e-mail plantado não chega ao stderr, e o registro sai sem prismaCode", () => {
        const lerStderr = capturarStderr();
        const erro = new Prisma.PrismaClientKnownRequestError(`Unique constraint failed for ${EMAIL}`, {
            code: "P2002",
            clientVersion: "7.10.1",
            meta: { value: EMAIL },
        });
        Object.assign(erro, { emailConsultado: EMAIL });

        createErrorLogger()("request", erro);

        const saida = lerStderr();
        expect(saida).not.toContain(EMAIL);
        expect(saida).not.toContain("prismaCode");
    });

    it("escreve uma única linha JSON no stderr", () => {
        const lerStderr = capturarStderr();

        createErrorLogger()("shutdown", comCodigo("ECONNRESET"));

        const saida = lerStderr();
        expect(saida.endsWith("\n")).toBe(true);
        expect(saida.trimEnd().split("\n")).toHaveLength(1);
        expect(JSON.parse(saida)).toMatchObject({
            event: "unexpected_error",
            context: "shutdown",
            errorType: "Error",
            systemCode: "ECONNRESET",
        });
    });
});
