import type { PrismaClient, Session as SessionRow } from "../../generated/prisma/client";

// ADR-012 e nota de 2026-11-22: o banco guarda o hash SHA-256 do token, nunca o token; o papel
// e o nome são retratos do lookup do login. Datas em string ISO 8601, como no domínio do
// ticket-service; a conversão para o tipo do Prisma fica aqui.
export interface Session {
  id: string;
  tokenHash: string;
  employeeId: string;
  role: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface SessionRepository {
  create(session: Session): Promise<Session>;
  findByTokenHash(tokenHash: string): Promise<Session | undefined>;
  // Logout: grava revokedAt numa sessão ainda não revogada; a linha fica. Devolve se revogou.
  revoke(tokenHash: string, revokedAt: string): Promise<boolean>;
  // Limpeza no login: apaga as sessões com expiresAt antes do instante dado. Devolve quantas.
  deleteExpiredBefore(instant: string): Promise<number>;
  count(): Promise<number>;
}

export function createSessionRepository(db: Pick<PrismaClient, "session">): SessionRepository {
  return {
    async create(session) {
      const row = await db.session.create({ data: toColumns(session) });
      return toDomain(row);
    },

    async findByTokenHash(tokenHash) {
      const row = await db.session.findUnique({ where: { tokenHash } });
      return row === null ? undefined : toDomain(row);
    },

    async revoke(tokenHash, revokedAt) {
      const result = await db.session.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date(revokedAt) },
      });
      return result.count > 0;
    },

    async deleteExpiredBefore(instant) {
      const result = await db.session.deleteMany({ where: { expiresAt: { lt: new Date(instant) } } });
      return result.count;
    },

    count() {
      return db.session.count();
    },
  };
}

function toColumns(session: Session) {
  return {
    id: session.id,
    tokenHash: session.tokenHash,
    employeeId: session.employeeId,
    role: session.role,
    name: session.name,
    createdAt: new Date(session.createdAt),
    expiresAt: new Date(session.expiresAt),
    revokedAt: session.revokedAt === undefined ? null : new Date(session.revokedAt),
  };
}

function toDomain(row: SessionRow): Session {
  return {
    id: row.id,
    tokenHash: row.tokenHash,
    employeeId: row.employeeId,
    role: row.role,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    ...(row.revokedAt === null ? {} : { revokedAt: row.revokedAt.toISOString() }),
  };
}
