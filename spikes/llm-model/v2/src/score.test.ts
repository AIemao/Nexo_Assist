// Pontuação e invariantes da V2 com registros fabricados (sem Agent), e aborto da rodada.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EmittedCall, ExecutionEvent, InvariantViolation, TurnRecordV2 } from "./record.ts";
import { validityOf } from "./protocol.ts";
import { runModel } from "./run.ts";
import { aggregateV2, canonicalJson, checkInvariants, invariantReport, reconcile, scoreTurnV2, toV1View } from "./score.ts";
import { VALID, call, caseById, cases, scripted, toolStep } from "./test-helpers.ts";

const emit = (step: number, order: number, toolName: string, rawArgs: unknown, toolCallId: string | null = `${toolName}-${order}`): EmittedCall => ({ step, order, toolCallId, toolName, rawArgs, validAtCapture: validityOf(toolName, rawArgs) });
const exec = (e: EmittedCall, outcome: ExecutionEvent["outcome"]): ExecutionEvent => ({ step: e.step, toolCallId: e.toolCallId, toolName: e.toolName, outcome, args: e.rawArgs, validAtCapture: e.validAtCapture });

function record(over: Partial<TurnRecordV2>): TurnRecordV2 {
  const steps = over.steps ?? [{ index: 0, verdict: "OK" as const, lateChunks: 0 }];
  return {
    type: "turn", experiment: "v2", model: "fabricado", provider: "mock", caseId: "C3", repetition: 1, startedAt: "", status: "completed",
    execError: null, attempts: 1, rateLimits: [], previousAttempts: [], emitted: [], steps, executions: [], acceptedSubmissions: [],
    terminal: null, toolLog: [], finalText: "", reasoning: { separatePresent: false, leakedInText: false, leakedInArgs: false },
    calls: steps.map((s) => ({ index: s.index, inputTokens: 900, outputTokens: 20, latencyMs: 10, finishReason: "tool-calls" })),
    totalInputTokens: 900, totalOutputTokens: 20, turnLatencyMs: 10, finishReason: "tool-calls",
    contextCheck: { status: "NOT_DETECTED", budget: 7680, maxReportedInputTokens: 900, estimatedInputTokens: 900, overBudget: false, suspectedSilentTruncation: false, unverified: false },
    externalRequests: [],
    ...over,
  };
}

// Turno correto: listMyTickets no passo 0, submissão aceita no passo 1.
function correctTurn(): TurnRecordV2 {
  const l1 = emit(0, 0, "listMyTickets", {});
  const s1 = emit(1, 1, "submitInterpretation", VALID.C3);
  return record({
    emitted: [l1, s1],
    steps: [{ index: 0, verdict: "OK", lateChunks: 0 }, { index: 1, verdict: "OK", lateChunks: 0 }],
    executions: [exec(l1, "EXECUTED"), exec(s1, "EXECUTED")],
    acceptedSubmissions: [{ step: 1, toolCallId: s1.toolCallId }],
    terminal: { step: 1, cause: "ACCEPTED" },
    toolLog: [{ tool: "listMyTickets", args: {} }],
  });
}

describe("invariantes com registros fabricados", () => {
  it("turno correto: nenhuma violação; reconciliação por (passo, toolCallId)", () => {
    assert.deepEqual(checkInvariants(correctTurn()), []);
    assert.deepEqual(reconcile(correctTurn()), { mode: "toolCallId", issues: [], diagnostics: [] });
  });

  it("I1: geração e submissão depois de uma submissão aceita (defeito do instrumento, não MULTIPLE)", () => {
    const base = correctTurn();
    // A submissão tardia (inválida) teve evento consistente (recusada pelo Mastra): só a I1 dispara.
    const lateInvalid = emit(2, 2, "submitInterpretation", { ...VALID.C3, intent: "FOO" });
    const lateEvent = exec(lateInvalid, "MASTRA_REFUSED");
    const r = {
      ...base,
      emitted: [...base.emitted, lateInvalid],
      executions: [...base.executions, lateEvent],
      steps: [...base.steps, { index: 2, verdict: "OK" as const, lateChunks: 0 }],
      calls: [...base.calls, { index: 2, inputTokens: 1, outputTokens: 1, latencyMs: 1, finishReason: "tool-calls" }],
    };
    assert.deepEqual(checkInvariants(r).map((v) => v.invariant), ["I1"]);
    const score = scoreTurnV2(r, caseById("C3"));
    assert.equal(score.codes.includes("SEM_PROTOCOL_MULTIPLE"), false, "a submissão posterior ao aceite não é falha do modelo");
    assert.equal(score.submissionsEmitted, 1);
  });

  it("I2: tool de negócio executada em passo violado (composição completa)", () => {
    const l1 = emit(0, 0, "listMyTickets", {});
    const s1 = emit(0, 1, "submitInterpretation", VALID.C3);
    const r = record({ emitted: [l1, s1], executions: [exec(l1, "EXECUTED"), exec(s1, "GUARD_REFUSED")], terminal: { step: 0, cause: "VIOLATION" }, toolLog: [{ tool: "listMyTickets", args: {} }] });
    assert.deepEqual(checkInvariants(r).map((v) => v.invariant), ["I2"]);
  });

  it("I3: duas submissões aceitas", () => {
    const s1 = emit(0, 0, "submitInterpretation", VALID.C3);
    const r = record({ emitted: [s1], executions: [exec(s1, "EXECUTED")], acceptedSubmissions: [{ step: 0, toolCallId: s1.toolCallId }, { step: 0, toolCallId: s1.toolCallId }], terminal: { step: 0, cause: "ACCEPTED" } });
    assert.ok(checkInvariants(r).some((v) => v.invariant === "I3"));
  });

  it("I4: execução sem emissão correspondente e execução sem registro na tool falsa", () => {
    const base = correctTurn();
    const phantom: ExecutionEvent = { step: 0, toolCallId: "fantasma", toolName: "listMyTickets", outcome: "EXECUTED", args: {}, validAtCapture: true };
    const r = { ...base, executions: [...base.executions, phantom] };
    const report = invariantReport(r);
    const details = report.violations.filter((v) => v.invariant === "I4").map((v) => v.detail);
    assert.ok(details.some((d) => d.includes("sem emissão correspondente")));
    assert.ok(details.some((d) => d.includes("toolLog: 2 execução(ões) e 1 registro(s)")));
    assert.ok(report.diagnostics.some((d) => d.detail.includes("2 execução(ões) vistas pelos hooks e 1 no registro")), "contagem por tool: diagnóstico");
  });

  it("I5: chunk tool-call depois do selo", () => {
    const r = { ...correctTurn(), steps: [{ index: 0, verdict: "OK" as const, lateChunks: 1 }, { index: 1, verdict: "OK" as const, lateChunks: 0 }] };
    assert.deepEqual(checkInvariants(r).map((v) => v.invariant), ["I5"]);
  });
});

describe("reconciliação por multiconjunto (sem toolCallId)", () => {
  it("duas chamadas idênticas sem id, duas execuções: sem deduplicação, sem violação; ordem de chaves indiferente", () => {
    const a = emit(0, 0, "searchArticles", { query: "vpn" }, null);
    const b = emit(0, 1, "searchArticles", { query: "vpn" }, null);
    const r = record({
      caseId: "C2",
      emitted: [a, b],
      executions: [exec(a, "EXECUTED"), { ...exec(b, "EXECUTED"), args: { query: "vpn" } }],
      toolLog: [{ tool: "searchArticles", args: { query: "vpn" } }, { tool: "searchArticles", args: { query: "vpn" } }],
    });
    assert.deepEqual(reconcile(r), { mode: "multiset", issues: [], diagnostics: [] });
    assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("mais execuções que emissões: violação de contagem (limitação: só contagens)", () => {
    const a = emit(0, 0, "searchArticles", { query: "vpn" }, null);
    const r = record({ caseId: "C2", emitted: [a], executions: [exec(a, "EXECUTED"), exec(a, "EXECUTED")], toolLog: [{ tool: "searchArticles", args: {} }, { tool: "searchArticles", args: {} }] });
    assert.equal(reconcile(r).mode, "multiset");
    assert.ok(reconcile(r).issues.some((i) => i.startsWith("multiconjunto: 2 evento(s) para 1 emissão(ões)")));
  });
});

describe("pontuação", () => {
  it("EXEC_*: incorreto em todas as métricas, inclusive protocolo; sem códigos de protocolo", () => {
    const r = { ...correctTurn(), status: "execution_error" as const, execError: { code: "EXEC_TIMEOUT" as const, message: "tempo" } };
    const score = scoreTurnV2(r, caseById("C3"));
    assert.equal(score.protocolCorrect, false);
    assert.deepEqual(score.codes, ["EXEC_TIMEOUT"]);
  });

  it("vazamento de raciocínio nos argumentos crus: SEM_REASONING_LEAK (tolerância zero)", () => {
    const r = { ...correctTurn(), reasoning: { separatePresent: false, leakedInText: false, leakedInArgs: true } };
    assert.ok(scoreTurnV2(r, caseById("C3")).codes.includes("SEM_REASONING_LEAK"));
  });

  it("aggregateV2: limite de protocolo (18 passa; 16 reprova e derruba o veredito)", () => {
    const answers: Record<string, () => TurnRecordV2> = {
      C3: correctTurn,
      C6: () => {
        const s = emit(0, 0, "submitInterpretation", VALID.C6);
        return record({ caseId: "C6", emitted: [s], executions: [exec(s, "EXECUTED")], acceptedSubmissions: [{ step: 0, toolCallId: s.toolCallId }], terminal: { step: 0, cause: "ACCEPTED" } });
      },
    };
    // Só C3 e C6 têm resposta fabricada aqui; os outros casos reusam a estrutura do C3 com o gabarito próprio
    // e por isso reprovam nas métricas herdadas. O teste confere o protocolo e a composição do veredito.
    const scores = cases.flatMap((c) => [1, 2, 3].map((repetition) => scoreTurnV2({ ...(answers[c.id] ?? correctTurn)(), caseId: c.id, repetition }, c)));
    const agg = aggregateV2(cases, scores);
    assert.equal(agg.protocol.count, 18);
    assert.equal(agg.protocol.pass, true);
    const broken = scores.map((s, i) => (i < 2 ? { ...s, protocolCorrect: false } : s));
    const agg2 = aggregateV2(cases, broken);
    assert.equal(agg2.protocol.count, 16);
    assert.equal(agg2.protocol.pass, false);
    assert.equal(agg2.approvedOnThresholds, false);
  });
});

describe("aborto da rodada por violação de invariante", () => {
  const options = (model: unknown, invariantCheck: (r: TurnRecordV2) => InvariantViolation[]) => ({
    model: model as never, modelLabel: "dublê", provider: "mock" as const, allowedHosts: [] as string[], cases, invariantCheck,
  });
  // Dublê que sempre submete uma interpretação válida, sozinha (um passo por turno).
  const alwaysSubmit = () => scripted(Array.from({ length: 40 }, (_, i) => toolStep(call("submitInterpretation", VALID.C3, `S${i}`))));

  it("o padrão confere as invariantes reais: rodada completa com 18 registros e sem aborto", async () => {
    const { model, state } = alwaysSubmit();
    const round = await runModel({ model: model as never, modelLabel: "dublê", provider: "mock", allowedHosts: [], cases });
    assert.equal(round.aborted, null);
    assert.equal(round.records.length, 18);
    assert.deepEqual(round.warmup.invariantViolations, []);
    assert.equal(state.generations, 19, "aquecimento + 18 turnos, uma geração cada");
  });

  it("violação no aquecimento: aborta antes de qualquer turno", async () => {
    const { model, state } = alwaysSubmit();
    const round = await runModel(options(model, (r) => (r.repetition === 0 ? [{ invariant: "I1", detail: "fabricada" }] : [])));
    assert.deepEqual(round.aborted, { at: "aquecimento", violations: [{ invariant: "I1", detail: "fabricada" }] });
    assert.equal(round.records.length, 0);
    assert.equal(state.generations, 1, "só o aquecimento gerou");
  });

  it("violação no segundo turno: aborta na hora, sem executar os demais", async () => {
    const { model, state } = alwaysSubmit();
    const round = await runModel(options(model, (r) => (r.caseId === "C1" && r.repetition === 2 ? [{ invariant: "I2", detail: "fabricada" }] : [])));
    assert.equal(round.aborted?.at, "C1, repetição 2");
    assert.equal(round.records.length, 2);
    assert.equal(state.generations, 3, "aquecimento + 2 turnos");
  });
});
