import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../generated/prisma/client";
import { requireConfig } from "../config";
import { createUnitOfWork, type UnitOfWork } from "./unit-of-work";

// busy_timeout do SQLite (opção timeout do better-sqlite3): espera por um lock de outra conexão
// antes de falhar com SQLITE_BUSY. 5000 ms é o padrão do better-sqlite3, escrito aqui de propósito.
export const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

export function createPrismaClient(databaseUrl: string, busyTimeoutMs = DEFAULT_BUSY_TIMEOUT_MS): PrismaClient {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl, timeout: busyTimeoutMs }) });
}

// Um cliente (uma conexão pelo adapter) por processo do servidor.
let current: { prisma: PrismaClient; unitOfWork: UnitOfWork } | undefined;

export function getUnitOfWork(): UnitOfWork {
  if (current === undefined) {
    const prisma = createPrismaClient(requireConfig().webDatabaseUrl);
    current = { prisma, unitOfWork: createUnitOfWork(prisma) };
  }
  return current.unitOfWork;
}

// Fecha a conexão do processo (testes e encerramento).
export async function closeDatabase(): Promise<void> {
  const open = current;
  current = undefined;
  await open?.prisma.$disconnect();
}
