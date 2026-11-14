// Vista V1 e pontuação (v3/CRITERIA.md, "Avaliação de cada resultado", "Limites de aprovação";
// plano de testes, "Pontuação e identidade"). scoreTurn e aggregate da V1, sem alteração.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aggregate, scoreTurn } from "../../src/score.ts";
import type { TurnRecordV3 } from "./record.ts";
import { aggregateV3, scoreTurnV3, toV1View } from "./score.ts";
import { VALID, caseById, cases, okPhase1, okPhase2, okRecord } from "./test-helpers.ts";

describe("vista V1", () => {
  it("tools de negócio e nomes desconhecidos só da fase 1; interpretação da fase 2; chamadas das duas fases; nenhum evento de submissão", () => {
    const record = okRecord({
      phase1: {
        ...okPhase1(),
        emitted: [
          { step: 0, order: 0, toolCallId: "S1", toolName: "searchArticles", rawArgs: { query: "" }, validAtCapture: false },
          { step: 0, order: 1, toolCallId: "U1", toolName: "submitInterpretation", rawArgs: {}, validAtCapture: null },
        ],
      },
      phase2: { ...okPhase2(), toolCalls: { count: 1, names: ["listMyTickets"] } },
    });
    const view = toV1View(record);
    assert.deepEqual(view.businessToolCalls, [{ tool: "searchArticles", args: { query: "" }, rejected: true }]);
    assert.deepEqual(view.otherToolCalls, [{ name: "submitInterpretation", args: {} }], "nome inventado na fase 1 conta; tool call da fase 2 não");
    assert.deepEqual(view.interpretationRaw, VALID.C3);
    assert.equal(view.calls.length, record.phase1.calls.length + (record.phase2?.calls.length ?? 0));
    assert.deepEqual(view.syntheticToolCalls, []);
    assert.equal(JSON.stringify(view).includes("acceptedSubmissions"), false, "nenhum evento de submissão fabricado");
  });

  it("vazamento: texto das duas fases, argumentos da fase 1, interpretação e object do Mastra", () => {
    const leaks: [string, Partial<TurnRecordV3>][] = [
      ["texto da fase 1", { phase1: { ...okPhase1(), reasoning: { separatePresent: false, leakedInText: true, leakedInArgs: false } } }],
      ["argumentos da fase 1", { phase1: { ...okPhase1(), reasoning: { separatePresent: false, leakedInText: false, leakedInArgs: true } } }],
      ["texto da fase 2", { phase2: { ...okPhase2(), reasoning: { ...okPhase2().reasoning, leakedInText: true } } }],
      ["interpretação", { phase2: { ...okPhase2(), reasoning: { ...okPhase2().reasoning, leakedInInterpretation: true } } }],
      ["object do Mastra", { phase2: { ...okPhase2(), reasoning: { ...okPhase2().reasoning, leakedInObject: true } } }],
    ];
    for (const [name, patch] of leaks) assert.ok(scoreTurnV3(okRecord(patch), caseById("C3")).codes.includes("SEM_REASONING_LEAK"), name);
    assert.equal(scoreTurnV3(okRecord(), caseById("C3")).codes.includes("SEM_REASONING_LEAK"), false);
  });

  it("o scoreTurnV3 é o scoreTurn da V1 sobre a vista, sem alteração", () => {
    const record = okRecord();
    assert.deepEqual(scoreTurnV3(record, caseById("C3")).v1, scoreTurn(toV1View(record), caseById("C3")));
  });
});

describe("C6 e tool call da fase 2", () => {
  const c6Record = (emitted: TurnRecordV3["phase1"]["emitted"]) =>
    okRecord({
      caseId: "C6",
      phase1: { ...okPhase1(), emitted, executions: [], toolLog: [] },
      phase2: { ...okPhase2(), interpretationRaw: VALID.C6, toolCalls: { count: 1, names: ["proposeTicketDraft"] } },
    } as Partial<TurnRecordV3>);

  it("C6 exige zero tools de negócio na fase 1; tool call da fase 2 não conta", () => {
    const none = scoreTurnV3(c6Record([]), caseById("C6"));
    assert.equal(none.v1.c6Expected, true);
    assert.equal(none.codes.includes("SEM_WRONG_TOOL"), false);
    const withTool = scoreTurnV3(c6Record([{ step: 0, order: 0, toolCallId: "L1", toolName: "listMyTickets", rawArgs: {}, validAtCapture: true }]), caseById("C6"));
    assert.equal(withTool.v1.c6Expected, false);
    assert.ok(withTool.codes.includes("SEM_WRONG_TOOL"));
  });
});

describe("agregação", () => {
  it("aggregateV3 é o aggregate da V1 sobre as pontuações herdadas, sem limite de protocolo", () => {
    const scores = cases.flatMap((c) => [1, 2, 3].map((repetition) => scoreTurnV3(okRecord({ caseId: c.id, repetition } as Partial<TurnRecordV3>), c)));
    const v3 = aggregateV3(cases, scores);
    assert.deepEqual(v3, aggregate(cases, scores.map((s) => s.v1)));
    assert.equal("protocol" in v3, false);
  });
});
