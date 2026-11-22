import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../generated/prisma/client";
import { requireConfig } from "../config";
import { createUnitOfWork, type UnitOfWork } from "./unit-of-work";

export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
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
