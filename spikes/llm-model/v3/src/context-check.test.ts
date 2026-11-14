// Truncamento por fase invocada e combinação (v3/CRITERIA.md, "Truncamento"; plano de testes,
// "Truncamento"). Regra de cada fase: contextCheckFromCalls da V2.1, sem mudança.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ContextCheck, ModelCallRecord, TruncationStatus } from "../../src/run-record.ts";
import { toMessages } from "../../src/run.ts";
import { contextCheckFromCalls, contextCheckOf } from "../../v2/src/run.ts";
import { estimatePhase1, estimatePhase2, runAttempt } from "./run.ts";
import { checkInvariantsV3, combineContextChecks, scoreTurnV3 } from "./score.ts";
import { VALID, caseById, completion, error401, error500, textCompletion, turnInput, withHttp } from "./test-helpers.ts";

const of = (status: TruncationStatus): ContextCheck =>
  status === "DETECTED" ? contextCheckOf(8000, 1000, false) : status === "UNKNOWN" ? contextCheckOf(null, 1000, true) : contextCheckOf(900, 1000, false);

describe("combinação das fases invocadas (tabela do CRITERIA)", () => {
  const table: [TruncationStatus, TruncationStatus | null, TruncationStatus][] = [
    ["DETECTED", null, "DETECTED"],
    ["DETECTED", "NOT_DETECTED", "DETECTED"],
    ["DETECTED", "UNKNOWN", "DETECTED"],
    ["NOT_DETECTED", "DETECTED", "DETECTED"],
    ["UNKNOWN", "DETECTED", "DETECTED"],
    ["NOT_DETECTED", "NOT_DETECTED", "NOT_DETECTED"],
    ["NOT_DETECTED", null, "NOT_DETECTED"],
    ["NOT_DETECTED", "UNKNOWN", "UNKNOWN"],
    ["UNKNOWN", "NOT_DETECTED", "UNKNOWN"],
    ["UNKNOWN", "UNKNOWN", "UNKNOWN"],
    ["UNKNOWN", null, "UNKNOWN"],
  ];
  for (const [p1, p2, expected] of table) {
    it(`fase 1 ${p1}, fase 2 ${p2 ?? "não executada"} → ${expected}`, () => {
      assert.equal(combineContextChecks(of(p1), p2 === null ? null : of(p2)).status, expected);
    });
  }

  it("nenhuma fase com inferência medida → UNKNOWN; maior inputTokens entre as fases invocadas", () => {
    const call = (finishReason: string, inputTokens: number | null): ModelCallRecord => ({ index: 0, inputTokens, outputTokens: null, latencyMs: 0, finishReason });
    const onlyErrors = contextCheckFromCalls([call("retry", null), call("error", null)], 1000);
    assert.equal(combineContextChecks(onlyErrors, null).status, "UNKNOWN");
    assert.equal(combineContextChecks(contextCheckOf(900, 1000, false), contextCheckOf(1200, 1000, false)).maxReportedInputTokens, 1200);
  });
});

describe("pelo caminho real (HTTP fabricado)", () => {
  it("obrigatório: fase 1 com uma inferência medida e erro definitivo; fase 2 não executada → NOT_DETECTED; o turno continua EXEC_*", async () => {
    const { result } = await withHttp([completion([["L1", "listMyTickets", {}]]), error401], () => runAttempt(turnInput("C3"), 1));
    const r = result.record;
    assert.equal(r.phase2, null);
    assert.deepEqual(r.phase1.calls.map((c) => `${c.finishReason}:${c.inputTokens}`), ["tool-calls:900", "error:null"]);
    assert.equal(r.contextCheck.status, "NOT_DETECTED");
    const score = scoreTurnV3(r, caseById("C3"));
    assert.equal(score.v1.execCode, "EXEC_PROVIDER_ERROR");
    assert.equal(score.v1.truncation, "NOT_DETECTED", "sem segunda penalização de truncamento");
  });

  it("adicional: fase 1 NOT_DETECTED; fase 2 invocada com 500 persistente (retry, retry, error) → UNKNOWN", async () => {
    const { result } = await withHttp([textCompletion("Certo."), error500, error500, error500], () => runAttempt(turnInput("C3"), 1));
    const r = result.record;
    assert.equal(r.phase1.contextCheck.status, "NOT_DETECTED");
    assert.equal(r.phase2?.contextCheck.status, "UNKNOWN");
    assert.equal(r.contextCheck.status, "UNKNOWN", "fase invocada sem medição não é fase não executada");
  });

  it("fase 1 DETECTED: a fase 2 roda mesmo assim; o turno é DETECTED (EXEC_CONTEXT_TRUNCATED no scoreTurn)", async () => {
    const big = { prompt_tokens: 8000, completion_tokens: 1, total_tokens: 8001 };
    const { result, requests } = await withHttp([textCompletion("Certo.", { usage: big }), textCompletion(JSON.stringify(VALID.C3))], () => runAttempt(turnInput("C3"), 1));
    assert.equal(requests.length, 2, "a fase 2 rodou");
    assert.equal(result.record.contextCheck.status, "DETECTED");
    assert.deepEqual(checkInvariantsV3(result.record), []);
    assert.equal(scoreTurnV3(result.record, caseById("C3")).v1.execCode, "EXEC_CONTEXT_TRUNCATED");
  });

  it("passo de inferência sem usage na fase 2 → fase 2 UNKNOWN", async () => {
    const { result } = await withHttp([textCompletion("Certo."), textCompletion(JSON.stringify(VALID.C3), { usage: undefined })], () => runAttempt(turnInput("C3"), 1));
    assert.equal(result.record.phase2?.contextCheck.status, "UNKNOWN");
    assert.equal(result.record.contextCheck.status, "UNKNOWN");
  });
});

describe("estimativa local de cada fase", () => {
  it("fase 1: prompt + histórico + schemas das tools; fase 2: prompt + histórico + transcrição + schema de resposta", () => {
    const messages = toMessages(caseById("C3"));
    const transcript = [{ role: "assistant", content: [{ type: "tool-call", toolCallId: "L1", toolName: "listMyTickets", input: {} }] }];
    assert.ok(estimatePhase1(messages) > 0);
    assert.ok(estimatePhase2(messages, transcript) > estimatePhase2(messages, []), "a transcrição entra na estimativa da fase 2");
  });
});
