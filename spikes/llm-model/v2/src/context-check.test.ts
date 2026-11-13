// V2.1: verificação de truncamento só com passos COM inferência (v2/CRITERIA.md, "V2.1").
// Passos "retry" e "error" ficam fora da completude e do maior inputTokens reportado; nada é imputado.
// Na V2 (e0469db), um único retry interno sem usage deixava o turno UNKNOWN.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { spikeModels } from "../../src/models.ts";
import type { ModelCallRecord } from "../../src/run-record.ts";
import { contextCheckFromCalls, contextCheckOf, runAttempt } from "./run.ts";
import { scoreTurnV2 } from "./score.ts";
import { VALID, caseById, cases } from "./test-helpers.ts";

const call = (index: number, finishReason: string | null, inputTokens: number | null): ModelCallRecord => ({ index, inputTokens, outputTokens: inputTokens === null ? null : 10, latencyMs: 1, finishReason });
const EST = 1000;

// A regra da V2 (e0469db), para comparação: todo passo conta.
function v2Rule(calls: readonly ModelCallRecord[], estimated: number) {
  const reported = calls.map((c) => c.inputTokens).filter((v): v is number => v !== null);
  return contextCheckOf(reported.length > 0 ? Math.max(...reported) : null, estimated, calls.length === 0 || calls.some((c) => c.inputTokens === null));
}

// Caminho real do Ollama (model router) com respostas HTTP fabricadas.
const completion = (calls: [string, string, unknown][]) => ({
  id: "c",
  object: "chat.completion",
  created: 1,
  model: "f",
  choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: calls.map(([id, name, args]) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } })) }, finish_reason: "tool_calls" }],
  usage: { prompt_tokens: 900, completion_tokens: 20, total_tokens: 920 },
});
const respond = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ollama = spikeModels().find((m) => m.label === "ollama qwen3:4b-instruct");
assert.ok(ollama);
async function realPath(script: (() => Response)[]) {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => (script[requests++] as () => Response)()) as typeof fetch;
  try {
    const input = { model: ollama!.config, modelLabel: ollama!.label, provider: "ollama" as const, testCase: { ...caseById("C3"), id: "C3" }, repetition: 1, allowedHosts: ["localhost:11434"] };
    return { ...(await runAttempt(input, 1)), requests };
  } finally {
    globalThis.fetch = original;
  }
}

describe("V2.1: passos retry e error fora da verificação de truncamento", () => {
  it("(a) 500 → retry (null) → tool de negócio com usage → submissão aceita com usage: NOT_DETECTED (caminho real)", async () => {
    const { record, requests } = await realPath([
      respond(500, { error: { message: "boom" } }),
      respond(200, completion([["L1", "listMyTickets", {}]])),
      respond(200, completion([["S1", "submitInterpretation", VALID.C3]])),
    ]);
    assert.equal(requests, 3);
    assert.deepEqual(record.calls.map((c) => `${c.index}:${c.finishReason}:${c.inputTokens}`), ["0:retry:null", "1:tool-calls:900", "2:tool-calls:900"]);
    assert.deepEqual(record.terminal, { step: 2, cause: "ACCEPTED" });
    assert.equal(record.contextCheck.status, "NOT_DETECTED");
    assert.equal(record.contextCheck.unverified, false);
    assert.equal(record.contextCheck.maxReportedInputTokens, 900);
    assert.equal(v2Rule(record.calls, record.contextCheck.estimatedInputTokens).status, "UNKNOWN", "a regra da V2 dava UNKNOWN");
    // O aggregate e o scoreTurn da V1 recebem NOT_DETECTED.
    assert.equal(scoreTurnV2(record, caseById("C3")).v1.truncation, "NOT_DETECTED");
  });

  it("(b) retry (null) seguido de passo de inferência com null: UNKNOWN", () => {
    const check = contextCheckFromCalls([call(0, "retry", null), call(1, "tool-calls", null)], EST);
    assert.equal(check.status, "UNKNOWN");
    assert.equal(check.unverified, true);
    assert.equal(check.maxReportedInputTokens, null);
  });

  it("(c) nenhum passo de inferência com usage observável: UNKNOWN (sem passos; só retry/error; inferência só com null)", () => {
    for (const calls of [[], [call(0, "retry", null), call(1, "retry", null), call(2, "error", null)], [call(0, "tool-calls", null), call(1, "stop", null)]]) {
      const check = contextCheckFromCalls(calls, EST);
      assert.equal(check.status, "UNKNOWN", JSON.stringify(calls));
      assert.equal(check.unverified, true);
      assert.equal(check.maxReportedInputTokens, null, "nada imputado");
    }
  });

  it("(d) retry sem usage não mascara passo de inferência acima do orçamento: DETECTED; retry fica fora do maior valor", () => {
    const over = contextCheckFromCalls([call(0, "retry", null), call(1, "tool-calls", 8000)], EST);
    assert.equal(over.status, "DETECTED");
    assert.equal(over.overBudget, true);
    assert.equal(over.maxReportedInputTokens, 8000);
    // Um passo retry que tivesse inputTokens (hipotético) não entra no maior valor reportado.
    const retryWithTokens = contextCheckFromCalls([call(0, "retry", 9000), call(1, "tool-calls", 900)], EST);
    assert.equal(retryWithTokens.maxReportedInputTokens, 900);
    assert.equal(retryWithTokens.status, "NOT_DETECTED");
  });

  it("(e) passo 1 com usage, passo 2 \"error\" (turno EXEC_*): NOT_DETECTED nesse turno (função pura e caminho real)", async () => {
    assert.equal(contextCheckFromCalls([call(0, "tool-calls", 900), call(1, "error", null)], EST).status, "NOT_DETECTED");
    const { record, error } = await realPath([respond(200, completion([["L1", "listMyTickets", {}]])), respond(401, { error: { message: "Invalid API Key" } })]);
    assert.equal(error?.code, "EXEC_PROVIDER_ERROR");
    assert.equal(record.status, "execution_error");
    assert.deepEqual(record.calls.map((c) => `${c.index}:${c.finishReason}:${c.inputTokens}`), ["0:tool-calls:900", "1:error:null"]);
    assert.equal(record.contextCheck.status, "NOT_DETECTED");
  });

  it("(f) sem retry/error: comportamento idêntico ao da V2", () => {
    const lists: ModelCallRecord[][] = [
      [],
      [call(0, "stop", 900)],
      [call(0, "tool-calls", 900), call(1, "tool-calls", 1200)],
      [call(0, "tool-calls", null), call(1, "stop", 900)],
      [call(0, "tool-calls", 8000)],
      [call(0, "stop", 100)],
      [call(0, null, 900)],
    ];
    for (const calls of lists) assert.deepEqual(contextCheckFromCalls(calls, EST), v2Rule(calls, EST), JSON.stringify(calls));
  });

  it("(g) regressão da suspeita de corte silencioso (abaixo de metade da estimativa), com e sem retry", () => {
    const suspected = contextCheckFromCalls([call(0, "stop", 100)], EST);
    assert.equal(suspected.suspectedSilentTruncation, true);
    assert.equal(suspected.status, "UNKNOWN");
    const boundary = contextCheckFromCalls([call(0, "stop", 500)], EST);
    assert.equal(boundary.suspectedSilentTruncation, false, "exatamente metade não é suspeita (< estrito)");
    assert.equal(boundary.status, "NOT_DETECTED");
    const withRetry = contextCheckFromCalls([call(0, "retry", null), call(1, "stop", 100)], EST);
    assert.equal(withRetry.suspectedSilentTruncation, true);
    assert.equal(withRetry.status, "UNKNOWN");
    const overAndLow = contextCheckFromCalls([call(0, "tool-calls", 100), call(1, "stop", 8000)], EST);
    assert.equal(overAndLow.status, "DETECTED", "DETECTED continua prevalecendo");
  });

  it("estimativa local e orçamento não mudam: os campos vêm de contextCheckOf, como na V2", () => {
    const check = contextCheckFromCalls([call(0, "stop", 900)], 1411);
    assert.deepEqual(check, contextCheckOf(900, 1411, false));
    assert.equal(check.budget, 7680);
    assert.equal(cases.length, 6);
  });
});
