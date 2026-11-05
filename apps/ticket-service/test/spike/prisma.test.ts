// SPIKE (descartável): Prisma 7 + SQLite. Banco em arquivo temporário, criado pela
// migração real (`prisma migrate deploy`), não por SQL manual.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "../../src/generated/prisma/client.js";

const appRoot = fileURLToPath(new URL("../..", import.meta.url));
const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");

let tempDir: string | undefined;
let prisma: PrismaClient | undefined;

beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "nexo-prisma-spike-"));
    const url = `file:${join(tempDir, "spike.db").replaceAll("\\", "/")}`;

    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
        cwd: appRoot,
        env: { ...process.env, DATABASE_URL: url },
        stdio: "pipe",
    });

    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}, 60_000);

afterAll(async () => {
    try {
        await prisma?.$disconnect();
    } finally {
        if (tempDir !== undefined) rmSync(tempDir, { recursive: true, force: true });
    }
});

describe("spike: Prisma 7 + SQLite", () => {
    it("updateMany com a versão esperada atualiza uma vez; a versão desatualizada não atualiza", async () => {
        if (prisma === undefined) throw new Error("PrismaClient não inicializado");
        const id = "INC-SPIKE-1";

        await prisma.ticket.create({ data: { id, version: 1, title: "Original" } });

        const primeira = await prisma.ticket.updateMany({
            where: { id, version: 1 },
            data: { title: "Atualizado", version: 2 },
        });
        expect(primeira.count).toBe(1);

        const segunda = await prisma.ticket.updateMany({
            where: { id, version: 1 },
            data: { title: "Atualizado", version: 2 },
        });
        expect(segunda.count).toBe(0);

        expect(await prisma.ticket.findUnique({ where: { id } })).toEqual({
            id,
            version: 2,
            title: "Atualizado",
        });
    });
});
