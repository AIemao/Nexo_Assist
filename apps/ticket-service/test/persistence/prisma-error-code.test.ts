import { describe, expect, it } from "vitest";

import { Prisma } from "../../src/generated/prisma/client.js";
import { readPrismaCode } from "../../src/persistence/prisma-error-code.js";

// Plano da fatia 0, D7: o código do Prisma só vem por instanceof.

describe("readPrismaCode", () => {
    it("devolve o código de um PrismaClientKnownRequestError", () => {
        const erro = new Prisma.PrismaClientKnownRequestError("falha de FK", {
            code: "P2003",
            clientVersion: "7.10.1",
        });

        expect(readPrismaCode(erro)).toBe("P2003");
    });

    it("Error comum com code P2003 não é erro do Prisma", () => {
        const erro = Object.assign(new Error("parece do Prisma"), { code: "P2003" });

        expect(readPrismaCode(erro)).toBeUndefined();
    });

    it.each<[string, unknown]>([
        ["string", "P2003"],
        ["objeto com code", { code: "P2003" }],
        ["undefined", undefined],
    ])("valor que não é Error (%s): undefined", (_nome, valor) => {
        expect(readPrismaCode(valor)).toBeUndefined();
    });
});
