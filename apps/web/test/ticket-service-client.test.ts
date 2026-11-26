import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTicketServiceClient } from "../src/server/ticket-service/client";
import { ANA, NOT_FOUND, startFakeTicketService, type FakeTicketService } from "./support/fake-ticket-service";

describe("cliente do ticket-service: lookup do funcionário (contrato §10; PW-12)", () => {
  let fake: FakeTicketService;
  const waits: number[] = [];
  const client = () =>
    createTicketServiceClient({
      baseUrl: fake.baseUrl,
      sleep: async (ms) => {
        waits.push(ms);
      },
      attemptTimeoutMs: 200,
    });

  beforeAll(async () => {
    fake = await startFakeTicketService();
  });
  afterAll(async () => {
    await fake.close();
  });

  it("envia ator SYSTEM, sem X-Actor-Employee-Id, e o corpo exatamente { email }", async () => {
    fake.script([{ status: 200, body: ANA }]);
    expect(await client().lookupEmployee("ana@nexo.example")).toStrictEqual({ kind: "found", employee: ANA });
    const [request] = fake.requests;
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/employees/lookup");
    expect(request?.body).toBe('{"email":"ana@nexo.example"}');
    expect(request?.headers["content-type"]).toBe("application/json");
    expect(request?.headers["x-actor-type"]).toBe("SYSTEM");
    expect(Object.keys(request?.headers ?? {}).filter((h) => h.startsWith("x-actor-"))).toStrictEqual(["x-actor-type"]);
  });

  it("404 EMPLOYEE_NOT_FOUND → not_found, sem retry", async () => {
    fake.script([{ status: 404, body: NOT_FOUND }]);
    expect(await client().lookupEmployee("x@nexo.example")).toStrictEqual({ kind: "not_found" });
    expect(fake.requests).toHaveLength(1);
  });

  it.each([400, 403, 415])("%i → rejected, sem retry", async (status) => {
    fake.script([{ status, body: { code: "X" } }]);
    expect(await client().lookupEmployee("x@nexo.example")).toStrictEqual({ kind: "rejected", status });
    expect(fake.requests).toHaveLength(1);
  });

  it("5xx persistente: 3 tentativas, backoff de 200 e 600 ms, unavailable", async () => {
    waits.length = 0;
    fake.script([{ status: 503 }]);
    expect(await client().lookupEmployee("x@nexo.example")).toStrictEqual({ kind: "unavailable" });
    expect(fake.requests).toHaveLength(3);
    expect(waits).toStrictEqual([200, 600]);
  });

  it("duas falhas e sucesso na terceira tentativa", async () => {
    fake.script([{ status: 500 }, { status: 502 }, { status: 200, body: ANA }]);
    expect(await client().lookupEmployee("ana@nexo.example")).toStrictEqual({ kind: "found", employee: ANA });
    expect(fake.requests).toHaveLength(3);
  });

  it("timeout por tentativa conta como falha de transporte e é repetido", async () => {
    fake.script([{ status: 200, body: ANA, delayMs: 1_000 }, { status: 200, body: ANA }]);
    expect(await client().lookupEmployee("ana@nexo.example")).toStrictEqual({ kind: "found", employee: ANA });
    expect(fake.requests).toHaveLength(2);
  });

  it("conexão recusada: 3 tentativas e unavailable", async () => {
    const closed = await startFakeTicketService();
    const baseUrl = closed.baseUrl;
    await closed.close();
    const result = await createTicketServiceClient({ baseUrl, sleep: async () => {}, attemptTimeoutMs: 200 }).lookupEmployee("x@nexo.example");
    expect(result).toStrictEqual({ kind: "unavailable" });
  });

  it("200 com corpo fora do contrato → rejected", async () => {
    fake.script([{ status: 200, body: { id: "EMP-A" } }]);
    expect(await client().lookupEmployee("ana@nexo.example")).toStrictEqual({ kind: "rejected", status: 200 });
  });
});
