import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUnitOfWork, type UnitOfWork } from "../src/server/persistence/unit-of-work";
import { expiredSessionCookie, readSessionCookie, sessionCookie } from "../src/server/session/cookie";
import { createSessionIn, findValidSession, revokeSession } from "../src/server/session/session-service";
import { hashSessionToken } from "../src/server/session/token";
import type { Clock, IdGenerator } from "../src/server/runtime";
import { createTestDatabase, type TestDatabase } from "./support/test-database";

const HOUR = 60 * 60 * 1000;
const T0 = new Date("2026-11-22T12:00:00.000Z");
const at = (ms: number): Clock => ({ now: () => new Date(T0.getTime() + ms) });
function ids(): IdGenerator {
  let n = 0;
  return { generate: () => `s-${++n}` };
}
const ana = { id: "EMP-A", name: "Ana Souza", role: "EMPLOYEE" };

describe("sessão (ADR-012 e nota de 2026-11-22)", () => {
  let database: TestDatabase;
  let uow: UnitOfWork;

  beforeEach(() => {
    database = createTestDatabase();
    uow = createUnitOfWork(database.prisma);
  });
  afterEach(async () => {
    await database.dispose();
  });

  const create = (clock: Clock, idGen = ids()) => uow.execute((repos) => createSessionIn(repos, ana, { clock, ids: idGen }));

  it("token de 256 bits em base64url; o banco guarda só o hash; o token não aparece em nenhuma coluna", async () => {
    const { token, session } = await create(at(0));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(session.tokenHash).toBe(hashSessionToken(token));
    const rows = await database.prisma.$queryRawUnsafe<Record<string, unknown>[]>('SELECT * FROM "Session"');
    expect(rows).toHaveLength(1);
    for (const value of Object.values(rows[0] ?? {})) expect(String(value)).not.toContain(token);
  });

  it("expiresAt − createdAt = 8 h; employeeId, role e name como retrato", async () => {
    const { session } = await create(at(0));
    expect(Date.parse(session.expiresAt) - Date.parse(session.createdAt)).toBe(8 * HOUR);
    expect(session).toMatchObject({ employeeId: "EMP-A", role: "EMPLOYEE", name: "Ana Souza" });
  });

  it("válida antes de expirar; expirada no instante de expiresAt e depois", async () => {
    const { token } = await create(at(0));
    expect(await findValidSession(uow, token, at(8 * HOUR - 1))).toBeDefined();
    expect(await findValidSession(uow, token, at(8 * HOUR))).toBeUndefined();
    expect(await findValidSession(uow, token, at(9 * HOUR))).toBeUndefined();
  });

  it("revogada é recusada; a linha fica com revokedAt", async () => {
    const { token } = await create(at(0));
    expect(await revokeSession(uow, token, at(HOUR))).toBe(true);
    expect(await findValidSession(uow, token, at(HOUR))).toBeUndefined();
    const row = await database.prisma.session.findUnique({ where: { tokenHash: hashSessionToken(token) } });
    expect(row?.revokedAt?.toISOString()).toBe(at(HOUR).now().toISOString());
  });

  it("token malformado ou desconhecido é recusado", async () => {
    expect(await findValidSession(uow, "curto", at(0))).toBeUndefined();
    expect(await findValidSession(uow, "a".repeat(43), at(0))).toBeUndefined();
  });

  it("limpeza no login: apaga a expirada há mais de 1 dia; mantém a expirada há menos (recusada) e as válidas", async () => {
    const idGen = ids();
    const old = await create(at(-40 * HOUR), idGen); // expirou há 32 h
    const recent = await create(at(-20 * HOUR), idGen); // expirou há 12 h
    const valid = await create(at(-1 * HOUR), idGen); // vale até daqui a 7 h
    await create(at(0), idGen); // o login que limpa
    const hashes = (await database.prisma.session.findMany()).map((s) => s.tokenHash);
    expect(hashes).not.toContain(hashSessionToken(old.token));
    expect(hashes).toContain(hashSessionToken(recent.token));
    expect(hashes).toContain(hashSessionToken(valid.token));
    expect(hashes).toHaveLength(3);
    expect(await findValidSession(uow, recent.token, at(0))).toBeUndefined();
    expect(await findValidSession(uow, valid.token, at(0))).toBeDefined();
  });
});

describe("cookie da sessão", () => {
  it("Set-Cookie com HttpOnly, SameSite=Lax, Path=/, Secure e Max-Age de 8 h", () => {
    const cookie = sessionCookie("abc");
    expect(cookie.split("; ")).toStrictEqual(["nexo_session=abc", "Max-Age=28800", "Path=/", "HttpOnly", "Secure", "SameSite=Lax"]);
  });

  it("logout: mesmo nome e atributos, com Max-Age=0", () => {
    expect(expiredSessionCookie().split("; ")).toStrictEqual(["nexo_session=", "Max-Age=0", "Path=/", "HttpOnly", "Secure", "SameSite=Lax"]);
  });

  it("lê o cookie da sessão do cabeçalho Cookie", () => {
    expect(readSessionCookie("a=1; nexo_session=tok; b=2")).toBe("tok");
    expect(readSessionCookie("a=1")).toBeUndefined();
    expect(readSessionCookie(null)).toBeUndefined();
    expect(readSessionCookie("nexo_session=")).toBeUndefined();
  });
});
