import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUnitOfWork, type UnitOfWork } from "../src/server/persistence/unit-of-work";
import type { Session } from "../src/server/persistence/session-repository";
import { createTestDatabase, type TestDatabase } from "./support/test-database";

const session: Session = {
  id: "8a0f6a0e-5b8c-4c1e-9f4e-2d1f3c4b5a69",
  tokenHash: "a".repeat(64),
  employeeId: "EMP-001",
  role: "EMPLOYEE",
  name: "Funcionário de Teste 1",
  createdAt: "2026-11-22T12:00:00.000Z",
  expiresAt: "2026-11-22T20:00:00.000Z",
};

describe("repositório de Session (ADR-012)", () => {
  let database: TestDatabase;
  let unitOfWork: UnitOfWork;

  beforeEach(() => {
    database = createTestDatabase();
    unitOfWork = createUnitOfWork(database.prisma);
  });

  afterEach(async () => {
    await database.dispose();
  });

  it("cria e busca pelo hash do token, sem revokedAt", async () => {
    const created = await unitOfWork.execute(({ sessions }) => sessions.create(session));
    const found = await unitOfWork.execute(({ sessions }) => sessions.findByTokenHash(session.tokenHash));
    expect(created).toStrictEqual(session);
    expect(found).toStrictEqual(session);
  });

  it("preserva revokedAt quando presente", async () => {
    const revoked = { ...session, revokedAt: "2026-11-22T13:00:00.000Z" };
    await unitOfWork.execute(({ sessions }) => sessions.create(revoked));
    const found = await unitOfWork.execute(({ sessions }) => sessions.findByTokenHash(session.tokenHash));
    expect(found).toStrictEqual(revoked);
  });

  it("devolve undefined para hash desconhecido", async () => {
    const found = await unitOfWork.execute(({ sessions }) => sessions.findByTokenHash("b".repeat(64)));
    expect(found).toBeUndefined();
  });

  it("recusa dois registros com o mesmo hash (@unique)", async () => {
    await unitOfWork.execute(({ sessions }) => sessions.create(session));
    await expect(
      unitOfWork.execute(({ sessions }) => sessions.create({ ...session, id: "outro-id" })),
    ).rejects.toThrow();
    expect(await unitOfWork.execute(({ sessions }) => sessions.count())).toBe(1);
  });
});
