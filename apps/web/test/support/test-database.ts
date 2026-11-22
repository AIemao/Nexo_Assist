import { randomUUID } from "node:crypto";
import { copyFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { inject } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { createPrismaClient } from "../../src/server/persistence/database";

export interface TestDatabase {
  url: string;
  prisma: PrismaClient;
  dispose(): Promise<void>;
}

// Cópia do banco-modelo migrado no globalSetup.
export function createTestDatabase(): TestDatabase {
  const template = inject("templateDatabasePath");
  const path = join(dirname(template), `${randomUUID()}.db`);
  copyFileSync(template, path);
  const url = `file:${path.replaceAll("\\", "/")}`;
  const prisma = createPrismaClient(url);

  return {
    url,
    prisma,
    async dispose() {
      await prisma.$disconnect();
      // No Windows o arquivo pode seguir travado logo após fechar a conexão.
      for (const file of [path, `${path}-journal`, `${path}-wal`, `${path}-shm`]) {
        rmSync(file, { force: true, maxRetries: 5, retryDelay: 100 });
      }
    },
  };
}
