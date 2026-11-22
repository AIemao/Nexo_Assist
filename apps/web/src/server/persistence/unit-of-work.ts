import type { PrismaClient } from "../../generated/prisma/client";
import { createSessionRepository, type SessionRepository } from "./session-repository";

// Padrão do ticket-service (ADR-008, "Conexão única do adapter better-sqlite3"; ADR-011, lições):
// todo acesso ao banco pelo fluxo da aplicação, inclusive leituras, passa pela Unit of Work.
export interface UnitOfWorkRepositories {
  sessions: SessionRepository;
}

export interface UnitOfWork {
  execute<T>(work: (repos: UnitOfWorkRepositories) => Promise<T>): Promise<T>;
}

export function createUnitOfWork(prisma: Pick<PrismaClient, "$transaction">): UnitOfWork {
  return {
    execute(work) {
      return prisma.$transaction(async (tx) =>
        work({
          sessions: createSessionRepository(tx),
        }),
      );
    },
  };
}
