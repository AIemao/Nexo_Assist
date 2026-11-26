import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getOrCreateOpenConversation } from "../src/server/conversation/conversation-service";
import { createPrismaClient } from "../src/server/persistence/database";
import { isUniqueViolation } from "../src/server/persistence/prisma-errors";
import { createUnitOfWork } from "../src/server/persistence/unit-of-work";
import type { Clock, IdGenerator } from "../src/server/runtime";
import { createTestDatabase, type TestDatabase } from "./support/test-database";

// busy_timeout curto: com as duas conexões no mesmo processo, a espera pelo lock bloqueia a thread
// (better-sqlite3 síncrono) até estourar; o serviço então relê numa nova Unit of Work.
const BUSY_TIMEOUT_MS = 500;
const clock: Clock = { now: () => new Date("2026-11-22T12:00:00.000Z") };
function sequentialIds(prefix: string): IdGenerator {
  let n = 0;
  return { generate: () => `${prefix}-${++n}` };
}

describe("invariante 17: uma conversa não encerrada por funcionário (DM v2.19; plano T5)", () => {
  let database: TestDatabase;

  beforeEach(() => {
    database = createTestDatabase(BUSY_TIMEOUT_MS);
  });

  afterEach(async () => {
    await database.dispose();
  });

  it("duas criações simultâneas, em duas conexões independentes, resultam numa única conversa", async () => {
    const first = createUnitOfWork(database.prisma);
    const second = createUnitOfWork(database.openConnection(BUSY_TIMEOUT_MS));
    const [a, b] = await Promise.all([
      getOrCreateOpenConversation(first, "EMP-001", { clock, ids: sequentialIds("a") }),
      getOrCreateOpenConversation(second, "EMP-001", { clock, ids: sequentialIds("b") }),
    ]);
    expect(a.id).toBe(b.id);
    const open = await database.prisma.conversation.findMany({ where: { ownerEmployeeId: "EMP-001", status: { not: "CLOSED" } } });
    expect(open).toHaveLength(1);
  });

  it("inserção direta duplicada de openOwnerEmployeeId falha pelo índice único", async () => {
    const row = (id: string) => ({
      id,
      ownerEmployeeId: "EMP-001",
      status: "AI_ACTIVE" as const,
      flow: "NONE" as const,
      stage: "IDLE" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      openOwnerEmployeeId: "EMP-001",
    });
    await database.prisma.conversation.create({ data: row("c1") });
    const duplicate = await database.prisma.conversation.create({ data: row("c2") }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(isUniqueViolation(duplicate)).toBe(true);
  });

  it("depois de CLOSED, uma conversa nova é criada", async () => {
    const uow = createUnitOfWork(database.prisma);
    const deps = { clock, ids: sequentialIds("c") };
    const first = await getOrCreateOpenConversation(uow, "EMP-001", deps);
    await uow.execute(({ conversations }) => conversations.close(first.id, "AGENT", clock.now().toISOString()));
    const second = await getOrCreateOpenConversation(uow, "EMP-001", deps);
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe("AI_ACTIVE");
    const closed = await uow.execute(({ conversations }) => conversations.findById(first.id));
    expect(closed).toMatchObject({ status: "CLOSED", resolutionSource: "AGENT" });
  });

  it("depois de recriar o banco do zero pelas migrações, o índice único continua lá", async () => {
    const webRoot = fileURLToPath(new URL("..", import.meta.url));
    const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
    const dir = mkdtempSync(join(tmpdir(), "nexo-web-recreate-"));
    const url = `file:${join(dir, "fresh.db").replaceAll("\\", "/")}`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: webRoot,
      env: { ...process.env, WEB_DATABASE_URL: url },
      stdio: "pipe",
    });
    const prisma = createPrismaClient(url);
    try {
      const indexes = await prisma.$queryRawUnsafe<{ name: string; unique: bigint | number }[]>(
        "PRAGMA index_list('Conversation')",
      );
      const index = indexes.find((i) => i.name === "Conversation_openOwnerEmployeeId_key");
      expect(index).toBeDefined();
      expect(Number(index?.unique)).toBe(1);
    } finally {
      await prisma.$disconnect();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
