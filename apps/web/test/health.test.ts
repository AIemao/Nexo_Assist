import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "./support/test-database";

describe("saúde do esqueleto (GET /api/health)", () => {
  let database: TestDatabase;

  beforeEach(() => {
    database = createTestDatabase();
    vi.stubEnv("WEB_DATABASE_URL", database.url);
    vi.stubEnv("TICKET_SERVICE_URL", "http://127.0.0.1:3999");
    vi.stubEnv("OLLAMA_BASE_URL", "http://localhost:11434/v1");
    vi.resetModules();
  });

  afterEach(async () => {
    // Fecha a conexão do servidor antes de apagar o banco (no Windows, o arquivo fica travado).
    const { closeDatabase } = await import("../src/server/persistence/database");
    await closeDatabase();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await database.dispose();
  });

  it("lê o banco do web, carrega o @nexo/contracts e constrói o Agent sem chamar o modelo", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { GET } = await import("../src/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({
      db: "ok",
      contracts: { ticketTypes: 2 },
      agent: "loaded",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("faz a leitura real no banco: sem a tabela Session, a saúde falha", async () => {
    await database.prisma.$executeRawUnsafe('DROP TABLE "Session"');
    const { GET } = await import("../src/app/api/health/route");
    await expect(GET()).rejects.toThrow();
  });
});
