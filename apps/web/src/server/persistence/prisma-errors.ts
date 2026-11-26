import { Prisma } from "../../generated/prisma/client";

// Só por instanceof, nunca lendo uma propriedade `code` arbitrária (padrão do ticket-service).
export function readPrismaCode(error: unknown): string | undefined {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
}

// Violação de unicidade (P2002).
export function isUniqueViolation(error: unknown): boolean {
  return readPrismaCode(error) === "P2002";
}

// SQLITE_BUSY depois do busy_timeout: o adapter better-sqlite3 o devolve como SocketTimeout, que o
// Prisma mapeia para P1008 ("Operation has timed out").
export function isBusyTimeout(error: unknown): boolean {
  return readPrismaCode(error) === "P1008";
}
