import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthDeps } from "../src/server/auth/deps";
import { handleLogin, LOGIN_MESSAGES } from "../src/server/auth/login";
import { handleLogout } from "../src/server/auth/logout";
import { logError } from "../src/server/observability/error-log";
import { createUnitOfWork } from "../src/server/persistence/unit-of-work";
import type { Clock, IdGenerator } from "../src/server/runtime";
import { findValidSession } from "../src/server/session/session-service";
import { createTicketServiceClient } from "../src/server/ticket-service/client";
import { ANA, CARLA, NOT_FOUND, startFakeTicketService, type FakeTicketService } from "./support/fake-ticket-service";
import { createTestDatabase, type TestDatabase } from "./support/test-database";

const EMAIL = "ana@nexo.example";
const clock: Clock = { now: () => new Date("2026-11-22T12:00:00.000Z") };
function ids(): IdGenerator {
  let n = 0;
  return { generate: () => `id-${++n}` };
}

const loginRequest = (body: unknown) =>
  new Request("http://127.0.0.1/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const tokenFrom = (response: Response) => /nexo_session=([^;]*)/.exec(response.headers.get("set-cookie") ?? "")?.[1] ?? "";

describe("POST /api/login e POST /api/logout", () => {
  let fake: FakeTicketService;
  let database: TestDatabase;
  let deps: AuthDeps;
  let output: string[];

  beforeAll(async () => {
    fake = await startFakeTicketService();
  });
  afterAll(async () => {
    await fake.close();
  });

  beforeEach(() => {
    database = createTestDatabase();
    deps = {
      unitOfWork: createUnitOfWork(database.prisma),
      ticketService: createTicketServiceClient({ baseUrl: fake.baseUrl, sleep: async () => {}, attemptTimeoutMs: 500 }),
      clock,
      ids: ids(),
      logError,
    };
    output = [];
    const capture = (chunk: unknown) => {
      output.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, "write").mockImplementation(capture);
    vi.spyOn(process.stderr, "write").mockImplementation(capture);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // O e-mail nunca aparece no stdout nem no stderr, em nenhum caso.
    expect(output.join("")).not.toContain(EMAIL);
    await database.dispose();
  });

  it("EMPLOYEE: 200, cookie da sessão, conversationId null e nenhuma conversa criada", async () => {
    fake.script([{ status: 200, body: ANA }]);
    const response = await handleLogin(loginRequest({ email: EMAIL, password: "qualquer" }), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ employee: { id: "EMP-A", name: "Ana Souza" }, conversationId: null });
    expect(response.headers.get("set-cookie")).toMatch(/^nexo_session=[A-Za-z0-9_-]{43}; Max-Age=28800; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    expect(await findValidSession(deps.unitOfWork, tokenFrom(response), clock)).toMatchObject({ employeeId: "EMP-A", name: "Ana Souza" });
    expect(await database.prisma.conversation.count()).toBe(0);
    // Contrato §10: corpo exatamente { email } e só o cabeçalho de ator SYSTEM.
    expect(fake.requests[0]?.body).toBe(JSON.stringify({ email: EMAIL }));
    expect(fake.requests[0]?.headers["x-actor-type"]).toBe("SYSTEM");
    expect(fake.requests[0]?.headers["x-actor-employee-id"]).toBeUndefined();
  });

  it("EMPLOYEE com conversa não encerrada: devolve o conversationId", async () => {
    await deps.unitOfWork.execute(({ conversations }) =>
      conversations.create({
        id: "conv-1",
        ownerEmployeeId: "EMP-A",
        status: "AI_ACTIVE",
        interactionContext: { flow: "NONE", stage: "IDLE" },
        createdAt: clock.now().toISOString(),
        updatedAt: clock.now().toISOString(),
      }),
    );
    fake.script([{ status: 200, body: ANA }]);
    const response = await handleLogin(loginRequest({ email: EMAIL, password: "x" }), deps);
    expect(await response.json()).toMatchObject({ conversationId: "conv-1" });
    expect(await database.prisma.conversation.count()).toBe(1);
  });

  it("ANALYST: 403 e nenhuma sessão", async () => {
    fake.script([{ status: 200, body: CARLA }]);
    const response = await handleLogin(loginRequest({ email: "carla@nexo.example", password: "x" }), deps);
    expect(response.status).toBe(403);
    expect(await response.json()).toStrictEqual({ message: LOGIN_MESSAGES.analystUnavailable });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await database.prisma.session.count()).toBe(0);
  });

  it("404 do ticket-service → 401 genérico", async () => {
    fake.script([{ status: 404, body: NOT_FOUND }]);
    const response = await handleLogin(loginRequest({ email: EMAIL, password: "x" }), deps);
    expect(response.status).toBe(401);
    expect(await response.json()).toStrictEqual({ message: LOGIN_MESSAGES.invalidCredentials });
  });

  it.each([400, 403, 415])("%i do ticket-service → 500 genérico, com registro de erro sem o e-mail", async (status) => {
    fake.script([{ status, body: { code: "X" } }]);
    const response = await handleLogin(loginRequest({ email: EMAIL, password: "x" }), deps);
    expect(response.status).toBe(500);
    expect(await response.json()).toStrictEqual({ message: LOGIN_MESSAGES.internal });
    const line = output.find((chunk) => chunk.includes("unexpected_error"));
    expect(JSON.parse(line ?? "{}")).toStrictEqual({ event: "unexpected_error", context: "login", errorType: "TicketServiceRejected", status });
  });

  it("5xx persistente depois do retry → 503", async () => {
    fake.script([{ status: 503 }]);
    const response = await handleLogin(loginRequest({ email: EMAIL, password: "x" }), deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toStrictEqual({ message: LOGIN_MESSAGES.unavailable });
    expect(fake.requests).toHaveLength(3);
  });

  it("sucesso na terceira tentativa → 200", async () => {
    fake.script([{ status: 500 }, { status: 500 }, { status: 200, body: ANA }]);
    const response = await handleLogin(loginRequest({ email: EMAIL, password: "x" }), deps);
    expect(response.status).toBe(200);
    expect(fake.requests).toHaveLength(3);
  });

  it.each([
    ["JSON malformado", "{"],
    ["sem e-mail", { password: "x" }],
    ["e-mail vazio", { email: "", password: "x" }],
    ["e-mail só com espaços", { email: "   ", password: "x" }],
    ["sem senha", { email: EMAIL }],
    ["senha vazia", { email: EMAIL, password: "" }],
    ["e-mail não string", { email: 1, password: "x" }],
  ])("corpo inválido (%s) → 400, sem chamar o ticket-service", async (_label, body) => {
    fake.script([{ status: 200, body: ANA }]);
    const response = await handleLogin(loginRequest(body), deps);
    expect(response.status).toBe(400);
    expect(await response.json()).toStrictEqual({ message: LOGIN_MESSAGES.invalidBody });
    expect(fake.requests).toHaveLength(0);
  });

  it("logout: revoga, expira o cookie, e o token antigo é recusado mesmo se reenviado", async () => {
    fake.script([{ status: 200, body: ANA }]);
    const token = tokenFrom(await handleLogin(loginRequest({ email: EMAIL, password: "x" }), deps));
    const logout = (cookie?: string) =>
      handleLogout(new Request("http://127.0.0.1/api/logout", { method: "POST", headers: cookie === undefined ? {} : { cookie } }), deps);

    const first = await logout(`nexo_session=${token}`);
    expect(first.status).toBe(204);
    expect(first.headers.get("set-cookie")).toBe("nexo_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax");
    expect(await findValidSession(deps.unitOfWork, token, clock)).toBeUndefined();

    const again = await logout(`nexo_session=${token}`);
    expect(again.status).toBe(204);
    expect(await findValidSession(deps.unitOfWork, token, clock)).toBeUndefined();
  });

  // Unit of Work que lança, com o e-mail na mensagem do erro, para provar que a mensagem não é registrada.
  const failingUnitOfWork = {
    execute: () => Promise.reject(new Error(`falha do banco com ${EMAIL}`)),
  };

  it("exceção inesperada no login (falha do banco) → 500 genérico, registro só com context e errorType", async () => {
    fake.script([{ status: 200, body: ANA }]);
    const response = await handleLogin(loginRequest({ email: EMAIL, password: "x" }), { ...deps, unitOfWork: failingUnitOfWork });
    expect(response.status).toBe(500);
    expect(await response.json()).toStrictEqual({ message: LOGIN_MESSAGES.internal });
    expect(response.headers.get("set-cookie")).toBeNull();
    const line = output.find((chunk) => chunk.includes("unexpected_error"));
    expect(JSON.parse(line ?? "{}")).toStrictEqual({ event: "unexpected_error", context: "login", errorType: "Error" });
  });

  it("exceção inesperada no logout (falha do banco) → 500 sem corpo e sem Set-Cookie", async () => {
    const request = new Request("http://127.0.0.1/api/logout", {
      method: "POST",
      headers: { cookie: `nexo_session=${"a".repeat(43)}` },
    });
    const response = await handleLogout(request, { ...deps, unitOfWork: failingUnitOfWork });
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
    expect(response.headers.get("set-cookie")).toBeNull();
    const line = output.find((chunk) => chunk.includes("unexpected_error"));
    expect(JSON.parse(line ?? "{}")).toStrictEqual({ event: "unexpected_error", context: "logout", errorType: "Error" });
  });

  it("logout sem sessão: 204", async () => {
    const response = await handleLogout(new Request("http://127.0.0.1/api/logout", { method: "POST" }), deps);
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
