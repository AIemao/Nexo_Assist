import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { VIEW_MY_TICKET_TICKET_FIELDS } from "../src/server/agent/extensions/view-my-ticket";
import { logError } from "../src/server/observability/error-log";
import { createTicketServiceClient } from "../src/server/ticket-service/client";
import { executeListMyTickets, type TicketReadDeps } from "../src/server/tickets/list-my-tickets";
import { executeViewMyTicket, type ViewMyTicketArgs } from "../src/server/tickets/view-my-ticket";
import {
  DETAIL_A1,
  DETAIL_A2,
  SEED_TICKET_IDS,
  SUMMARY_A1,
  SUMMARY_A2,
  TICKET_NOT_FOUND,
  TKT_X,
  startFakeTicketService,
  type FakeTicketService,
  type SeenRequest,
} from "./support/fake-ticket-service";

const actor = { employeeId: "EMP-A" };
const context = { actor };

describe("leituras de chamados: listMyTickets e viewMyTicket", () => {
  let fake: FakeTicketService;
  let deps: TicketReadDeps;
  let stderr: string[];

  beforeAll(async () => {
    fake = await startFakeTicketService();
  });
  afterAll(async () => {
    await fake.close();
  });

  beforeEach(() => {
    deps = {
      ticketService: createTicketServiceClient({ baseUrl: fake.baseUrl, sleep: async () => {}, attemptTimeoutMs: 200 }),
      logError,
    };
    stderr = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Contrato §2.2 e §7.1: exatamente os dois cabeçalhos do ator EMPLOYEE, com o id da sessão.
  const expectActorHeaders = (request: SeenRequest | undefined) => {
    expect(request?.headers["x-actor-type"]).toBe("EMPLOYEE");
    expect(request?.headers["x-actor-employee-id"]).toBe("EMP-A");
    expect(Object.keys(request?.headers ?? {}).filter((h) => h.startsWith("x-actor-")).sort()).toStrictEqual([
      "x-actor-employee-id",
      "x-actor-type",
    ]);
  };

  describe("listMyTickets", () => {
    it("seis campos da V4 mais currentDueAt e isOverdue, na ordem do ticket-service", async () => {
      fake.script([{ status: 200, body: { tickets: [SUMMARY_A1, SUMMARY_A2] } }]);
      const outcome = await executeListMyTickets({}, context, deps);
      expect(outcome).toStrictEqual({
        status: "SUCCESS",
        result: {
          tickets: [
            {
              id: SEED_TICKET_IDS["TKT-A1"],
              type: "INC",
              category: "HARDWARE",
              title: "Notebook lento",
              priority: "MEDIUM",
              status: "WAITING_ANALYST",
              currentDueAt: "2026-11-25T14:40:00.000Z",
              isOverdue: false,
            },
            {
              id: SEED_TICKET_IDS["TKT-A2"],
              type: "INC",
              category: "ACCESS",
              title: "Senha do SAP não funciona",
              priority: "MEDIUM",
              status: "RESOLVED",
              currentDueAt: "2026-11-18T21:00:00.000Z",
              isOverdue: null,
            },
          ],
        },
        meta: { ticketIds: [SEED_TICKET_IDS["TKT-A1"], SEED_TICKET_IDS["TKT-A2"]] },
      });
      const [request] = fake.requests;
      expect(request?.method).toBe("GET");
      expect(request?.path).toBe("/tickets");
      expectActorHeaders(request);
    });

    it("chaves de cada item: os seis da V4 na ordem do descritor e depois currentDueAt e isOverdue", async () => {
      fake.script([{ status: 200, body: { tickets: [SUMMARY_A1] } }]);
      const outcome = await executeListMyTickets({}, context, deps);
      const item = outcome.status === "SUCCESS" ? outcome.result.tickets[0] : undefined;
      expect(Object.keys(item ?? {})).toStrictEqual(["id", "type", "category", "title", "priority", "status", "currentDueAt", "isOverdue"]);
    });

    it("lista vazia é SUCCESS", async () => {
      fake.script([{ status: 200, body: { tickets: [] } }]);
      expect(await executeListMyTickets({}, context, deps)).toStrictEqual({
        status: "SUCCESS",
        result: { tickets: [] },
        meta: { ticketIds: [] },
      });
    });
  });

  describe("viewMyTicket", () => {
    it("chamado do próprio funcionário → found: true com a projeção do A5", async () => {
      fake.script([{ status: 200, body: DETAIL_A1 }]);
      const outcome = await executeViewMyTicket({ ticketId: SEED_TICKET_IDS["TKT-A1"] }, context, deps);
      expect(outcome).toStrictEqual({
        status: "SUCCESS",
        result: {
          found: true,
          ticket: {
            id: SEED_TICKET_IDS["TKT-A1"],
            type: "INC",
            title: "Notebook lento",
            description: "O notebook está lento para abrir programas desde a última atualização.",
            category: "HARDWARE",
            priority: "MEDIUM",
            status: "WAITING_ANALYST",
            createdAt: "2026-11-20T14:40:00.000Z",
            updatedAt: "2026-11-20T14:40:00.000Z",
            currentDueAt: "2026-11-25T14:40:00.000Z",
            isOverdue: false,
          },
        },
        meta: { ticketId: SEED_TICKET_IDS["TKT-A1"] },
      });
      expect(fake.requests[0]?.path).toBe(`/tickets/${SEED_TICKET_IDS["TKT-A1"]}`);
      expectActorHeaders(fake.requests[0]);
    });

    it("negação idêntica (AF D17): inexistente (TKT-X), alheio (TKT-B1) e malformado dão a mesma saída inteira", async () => {
      const outputs: string[] = [];
      for (const ticketId of [TKT_X, SEED_TICKET_IDS["TKT-B1"], "abc"]) {
        fake.script([{ status: 404, body: TICKET_NOT_FOUND }]);
        outputs.push(JSON.stringify(await executeViewMyTicket({ ticketId }, context, deps)));
      }
      expect(outputs[0]).toBe('{"status":"SUCCESS","result":{"found":false},"meta":{}}');
      expect(new Set(outputs).size).toBe(1);
    });

    it("TKT-X = INC-999999 → { found: false }, com o id no caminho", async () => {
      fake.script([{ status: 404, body: TICKET_NOT_FOUND }]);
      const outcome = await executeViewMyTicket({ ticketId: TKT_X }, context, deps);
      expect(outcome.result).toStrictEqual({ found: false });
      expect(fake.requests[0]?.path).toBe("/tickets/INC-999999");
    });

    it("o contrato não define formato de id: o malformado vai ao ticket-service, codificado no caminho", async () => {
      fake.script([{ status: 404, body: TICKET_NOT_FOUND }]);
      await executeViewMyTicket({ ticketId: "a/b ç" }, context, deps);
      expect(fake.requests).toHaveLength(1);
      expect(fake.requests[0]?.path).toBe(`/tickets/${encodeURIComponent("a/b ç")}`);
    });

    it("404 com outro código → FAILED, não found: false", async () => {
      fake.script([{ status: 404, body: { type: "about:blank", title: "Not Found", status: 404, code: "OUTRO" } }]);
      expect(await executeViewMyTicket({ ticketId: TKT_X }, context, deps)).toStrictEqual({
        status: "FAILED",
        result: { available: false },
      });
    });

    it("argumentos com identidade não chegam à requisição: idêntica, por inteiro, à de argumentos limpos", async () => {
      fake.script([{ status: 200, body: DETAIL_A1 }]);
      await executeViewMyTicket({ ticketId: SEED_TICKET_IDS["TKT-A1"] }, context, deps);
      const clean = fake.requests[0];
      // Contorna o tipo de propósito: a execução recebe só o que o schema aceitaria, mas mesmo assim
      // nenhuma propriedade além de ticketId é repassada ao cliente.
      const dirty: ViewMyTicketArgs = Object.assign(
        { ticketId: SEED_TICKET_IDS["TKT-A1"] },
        { employeeId: "EMP-B", actor: { employeeId: "EMP-B" }, email: "b@x", headers: { "X-Actor-Employee-Id": "EMP-B" } },
      );
      fake.script([{ status: 200, body: DETAIL_A1 }]);
      await executeViewMyTicket(dirty, context, deps);
      const sent = fake.requests[0];
      // Requisição inteira: método, caminho, todos os cabeçalhos e corpo. Nenhum cabeçalho varia entre
      // as duas requisições (GET sem corpo, sem content-length), então a lista de exclusão é vazia.
      const VARYING_HEADERS: readonly string[] = [];
      const whole = (request: SeenRequest | undefined) => ({
        method: request?.method,
        path: request?.path,
        headers: Object.fromEntries(Object.entries(request?.headers ?? {}).filter(([name]) => !VARYING_HEADERS.includes(name))),
        body: request?.body,
      });
      expect(whole(sent)).toStrictEqual(whole(clean));
      expect(sent?.body).toBe("");
      expectActorHeaders(sent);
    });

    it("a ordem das chaves do chamado segue VIEW_MY_TICKET_TICKET_FIELDS: aberto, sem resolvedAt", async () => {
      fake.script([{ status: 200, body: DETAIL_A1 }]);
      const outcome = await executeViewMyTicket({ ticketId: SEED_TICKET_IDS["TKT-A1"] }, context, deps);
      const ticket = outcome.status === "SUCCESS" && outcome.result.found ? outcome.result.ticket : undefined;
      expect(Object.keys(ticket ?? {})).toStrictEqual(VIEW_MY_TICKET_TICKET_FIELDS.filter((field) => field !== "resolvedAt"));
    });

    it("a ordem das chaves do chamado segue VIEW_MY_TICKET_TICKET_FIELDS: RESOLVED, com a lista inteira", async () => {
      fake.script([{ status: 200, body: DETAIL_A2 }]);
      const outcome = await executeViewMyTicket({ ticketId: SEED_TICKET_IDS["TKT-A2"] }, context, deps);
      const ticket = outcome.status === "SUCCESS" && outcome.result.found ? outcome.result.ticket : undefined;
      expect(Object.keys(ticket ?? {})).toStrictEqual([...VIEW_MY_TICKET_TICKET_FIELDS]);
    });

    it("chamado RESOLVED → found: true com resolvedAt e isOverdue null", async () => {
      fake.script([{ status: 200, body: DETAIL_A2 }]);
      const outcome = await executeViewMyTicket({ ticketId: SEED_TICKET_IDS["TKT-A2"] }, context, deps);
      expect(outcome).toMatchObject({
        status: "SUCCESS",
        result: {
          found: true,
          ticket: { id: SEED_TICKET_IDS["TKT-A2"], status: "RESOLVED", resolvedAt: "2026-11-16T15:00:00.000Z", isOverdue: null },
        },
        meta: { ticketId: SEED_TICKET_IDS["TKT-A2"] },
      });
    });
  });

  // Regra do status (contrato §8.2 e §12; DM §3.2 e §8.5.2): violação é resposta fora do contrato.
  describe("regra de resolvedAt e isOverdue pelo status", () => {
    const { resolvedAt: _resolvedAt, ...detailA2WithoutResolvedAt } = DETAIL_A2;
    const { resolvedAt: _summaryResolvedAt, ...summaryA2WithoutResolvedAt } = SUMMARY_A2;
    const violations = [
      ["aberto com resolvedAt", { ...SUMMARY_A1, resolvedAt: "2026-11-21T10:00:00.000Z" }, { ...DETAIL_A1, resolvedAt: "2026-11-21T10:00:00.000Z" }],
      ["RESOLVED sem resolvedAt", summaryA2WithoutResolvedAt, detailA2WithoutResolvedAt],
      ["aberto com isOverdue null", { ...SUMMARY_A1, isOverdue: null }, { ...DETAIL_A1, isOverdue: null }],
      ["RESOLVED com isOverdue boolean", { ...SUMMARY_A2, isOverdue: false }, { ...DETAIL_A2, isOverdue: true }],
    ] as const;

    const expectRejectedLog = () => {
      expect(stderr).toHaveLength(1);
      expect(JSON.parse(stderr[0] ?? "{}")).toStrictEqual({
        event: "unexpected_error",
        context: "tickets",
        errorType: "TicketServiceRejectedError",
      });
    };

    it.each(violations)("listagem, %s → FAILED", async (_label, summary) => {
      fake.script([{ status: 200, body: { tickets: [summary] } }]);
      expect(await executeListMyTickets({}, context, deps)).toStrictEqual({ status: "FAILED", result: { available: false } });
      expectRejectedLog();
    });

    it.each(violations)("detalhe, %s → FAILED", async (_label, _summary, detail) => {
      fake.script([{ status: 200, body: detail }]);
      expect(await executeViewMyTicket({ ticketId: SEED_TICKET_IDS["TKT-A1"] }, context, deps)).toStrictEqual({
        status: "FAILED",
        result: { available: false },
      });
      expectRejectedLog();
    });
  });

  describe("retry (PW-12) e falhas", () => {
    it("duas falhas 5xx e sucesso na terceira tentativa", async () => {
      fake.script([{ status: 500 }, { status: 503 }, { status: 200, body: { tickets: [SUMMARY_A1] } }]);
      expect((await executeListMyTickets({}, context, deps)).status).toBe("SUCCESS");
      expect(fake.requests).toHaveLength(3);
    });

    it("timeout seguido de sucesso", async () => {
      fake.script([{ status: 200, body: DETAIL_A1, delayMs: 1_000 }, { status: 200, body: DETAIL_A1 }]);
      expect((await executeViewMyTicket({ ticketId: SEED_TICKET_IDS["TKT-A1"] }, context, deps)).status).toBe("SUCCESS");
      expect(fake.requests).toHaveLength(2);
    });

    it("falha persistente → FAILED com { available: false } e exatamente 3 requisições", async () => {
      fake.script([{ status: 502 }]);
      expect(await executeListMyTickets({}, context, deps)).toStrictEqual({ status: "FAILED", result: { available: false } });
      expect(fake.requests).toHaveLength(3);
    });

    it.each([400, 403, 422])("%i sem retry → FAILED", async (status) => {
      fake.script([{ status, body: { code: "X" } }]);
      expect(await executeViewMyTicket({ ticketId: TKT_X }, context, deps)).toStrictEqual({
        status: "FAILED",
        result: { available: false },
      });
      expect(fake.requests).toHaveLength(1);
    });

    it("defeito do BFF (resposta fora do contrato) → FAILED, log só com evento, context e errorType, sem ids", async () => {
      fake.script([{ status: 200, body: { tickets: [{ id: SEED_TICKET_IDS["TKT-A1"] }] } }]);
      expect(await executeListMyTickets({}, context, deps)).toStrictEqual({ status: "FAILED", result: { available: false } });
      expect(stderr).toHaveLength(1);
      expect(JSON.parse(stderr[0] ?? "{}")).toStrictEqual({
        event: "unexpected_error",
        context: "tickets",
        errorType: "TicketServiceRejectedError",
      });
      for (const secret of ["EMP-A", ...Object.values(SEED_TICKET_IDS)]) expect(stderr.join("")).not.toContain(secret);
    });

    it("indisponível → registro com errorType de indisponibilidade, sem o ticketId", async () => {
      fake.script([{ status: 503 }]);
      await executeViewMyTicket({ ticketId: SEED_TICKET_IDS["TKT-A1"] }, context, deps);
      expect(JSON.parse(stderr[0] ?? "{}")).toStrictEqual({
        event: "unexpected_error",
        context: "tickets",
        errorType: "TicketServiceUnavailableError",
      });
      expect(stderr.join("")).not.toContain(SEED_TICKET_IDS["TKT-A1"]);
    });
  });
});
