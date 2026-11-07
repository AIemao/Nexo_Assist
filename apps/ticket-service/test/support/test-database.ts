import { randomUUID } from "node:crypto";
import { copyFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { inject } from "vitest";
import { PrismaClient } from "../../src/generated/prisma/client.js";

export interface TestDatabase {
    prisma: PrismaClient;
    reset(): Promise<void>;
    dispose(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
    const template = inject("templateDatabasePath");
    const path = join(dirname(template), `${randomUUID()}.db`);
    copyFileSync(template, path);

    const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) });

    return {
        prisma,
        // FKs com Restrict: os filhos de Ticket saem antes dele.
        async reset() {
            await prisma.idempotencyRecord.deleteMany();
            await prisma.ticketEvent.deleteMany();
            await prisma.ticket.deleteMany();
            await prisma.ticketCounter.deleteMany();
        },
        async dispose() {
            await prisma.$disconnect();
            // No Windows o arquivo pode seguir travado logo após fechar a conexão.
            for (const file of [path, `${path}-journal`, `${path}-wal`, `${path}-shm`]) {
                rmSync(file, { force: true, maxRetries: 5, retryDelay: 100 });
            }
        },
    };
}
