import { Prisma } from "../generated/prisma/client.js";

// Leitor do código do Prisma para o registro de erros (README §12 #22; plano da fatia 0, D7):
// só por instanceof, nunca lendo uma propriedade `code` arbitrária. Fica na persistência
// porque o Prisma só aparece nesta camada (ADR-008, condição 4); a raiz de composição o
// injeta no createErrorLogger.
export function readPrismaCode(error: unknown): string | undefined {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
}
