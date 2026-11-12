// Política de vazamento nos argumentos das tools (v2/src/leak.ts; v2/CRITERIA.md, "Segurança").
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { redactReasoningValue } from "../../src/run.ts";
import { declaredPathsOf, redactToolArgs } from "./leak.ts";
import { runAttempt } from "./run.ts";
import { invariantReport, scoreTurnV2 } from "./score.ts";
import { VALID, call, caseById, scripted, toolStep, turnInput } from "./test-helpers.ts";

const REMOVED = "[raciocínio removido]";

describe("caminhos declarados nos schemas das tools", () => {
  it("requestHandoff declara só `reason` no topo; o interpretationSchema não entra (usa a regra completa)", () => {
    assert.deepEqual([...(declaredPathsOf("requestHandoff") ?? [])], ["reason"]);
    assert.deepEqual([...(declaredPathsOf("proposeTicketDraft") ?? [])], ["title", "description", "type", "category", "impactAssessment", "impactAssessment.affectedScope", "impactAssessment.workImpact", "impactAssessment.commitmentRisk"]);
    assert.equal(declaredPathsOf("submitInterpretation"), null);
    assert.equal(declaredPathsOf("fooBar"), null);
  });
});

describe("pelo Agent (dublê): o que é gravado e o que é pontuado", () => {
  it("C5 correto: requestHandoff.reason legítimo → sem SEM_REASONING_LEAK, reason gravado intacto", async () => {
    const reason = "quer falar com uma pessoa";
    const { model } = scripted([toolStep(call("requestHandoff", { reason }, "H1")), toolStep(call("submitInterpretation", VALID.C5, "S1"))]);
    const { record } = await runAttempt(turnInput("C5", model), 1);
    assert.deepEqual(record.emitted[0]?.rawArgs, { reason });
    assert.deepEqual(record.executions[0]?.args, { reason });
    assert.deepEqual(record.toolLog, [{ tool: "requestHandoff", args: { reason } }]);
    assert.equal(record.reasoning.leakedInArgs, false);
    const score = scoreTurnV2(record, caseById("C5"));
    assert.equal(score.codes.includes("SEM_REASONING_LEAK"), false, JSON.stringify(score.codes));
    assert.equal(score.protocolCorrect && score.v1.toolCorrect && score.v1.intentCorrect && score.v1.zodValid, true);
    assert.deepEqual(invariantReport(record), { violations: [], diagnostics: [] });
  });

  it("marcador <think> num campo declarado (requestHandoff.reason): detectado e removido antes de gravar", async () => {
    const { model } = scripted([toolStep(call("requestHandoff", { reason: "<think>vou transferir</think>quer humano" }, "H1")), toolStep(call("submitInterpretation", VALID.C5, "S1"))]);
    const { record } = await runAttempt(turnInput("C5", model), 1);
    const expected = { reason: `${REMOVED}quer humano` };
    assert.deepEqual(record.emitted[0]?.rawArgs, expected);
    assert.deepEqual(record.executions[0]?.args, expected);
    assert.deepEqual(record.toolLog, [{ tool: "requestHandoff", args: expected }]);
    assert.equal(JSON.stringify(record).includes("vou transferir"), false, "conteúdo nunca gravado");
    assert.ok(scoreTurnV2(record, caseById("C5")).codes.includes("SEM_REASONING_LEAK"));
    assert.deepEqual(invariantReport(record).violations, []);
  });

  it("searchArticles { query, thought } (chave não declarada): detectada e removida antes de gravar", async () => {
    const interpretation = { intent: "ANSWER_KB", confidence: "HIGH", entities: { operatingSystem: "Windows 10" }, missingFields: [] };
    const { model } = scripted([toolStep(call("searchArticles", { query: "vpn", thought: "o usuário deve querer vpn" }, "A1")), toolStep(call("submitInterpretation", interpretation, "S1"))]);
    const { record } = await runAttempt(turnInput("C2", model), 1);
    assert.deepEqual(record.emitted[0]?.rawArgs, { query: "vpn", thought: REMOVED });
    assert.equal(record.emitted[0]?.validAtCapture, false, "chave extra: inválida no valor original");
    assert.equal(record.executions[0]?.outcome, "MASTRA_REFUSED");
    assert.equal(JSON.stringify(record).includes("deve querer"), false, "conteúdo nunca gravado");
    assert.ok(scoreTurnV2(record, caseById("C2")).codes.includes("SEM_REASONING_LEAK"));
    assert.deepEqual(invariantReport(record).violations, []);
  });

  it("interpretação com marcador e com chave de raciocínio: regra completa da V1 continua valendo", async () => {
    const withMarker = { ...VALID.C3, entities: { problem: "<think>hmm</think>ver chamados" } };
    const a = await runAttempt(turnInput("C3", scripted([toolStep(call("submitInterpretation", withMarker, "S1"))]).model), 1);
    assert.deepEqual(a.record.emitted[0]?.rawArgs, { ...VALID.C3, entities: { problem: `${REMOVED}ver chamados` } });
    assert.ok(scoreTurnV2(a.record, caseById("C3")).codes.includes("SEM_REASONING_LEAK"));

    const withKey = { ...VALID.C3, reasoning: "passo a passo" };
    const b = await runAttempt(turnInput("C3", scripted([toolStep(call("submitInterpretation", withKey, "S1"))]).model), 1);
    assert.deepEqual(b.record.emitted[0]?.rawArgs, { ...VALID.C3, reasoning: REMOVED });
    const codes = scoreTurnV2(b.record, caseById("C3")).codes;
    assert.ok(codes.includes("SEM_REASONING_LEAK"));
    assert.ok(codes.includes("SEM_INVALID_INTERPRETATION"), "chave extra: interpretação inválida");
  });
});

describe("redactToolArgs: isenção pelo CAMINHO declarado, não pelo nome da chave", () => {
  it("reason aninhado onde o schema não o declara (proposeTicketDraft.impactAssessment.reason): sujeito à regra", () => {
    const r = redactToolArgs("proposeTicketDraft", { title: "t", impactAssessment: { affectedScope: "SELF", reason: "achei que era SELF" } });
    assert.equal(r.leaked, true);
    assert.deepEqual(r.value, { title: "t", impactAssessment: { affectedScope: "SELF", reason: REMOVED } });
  });

  it("reason aninhado dentro do reason declarado (requestHandoff.reason.reason): sujeito à regra", () => {
    const r = redactToolArgs("requestHandoff", { reason: { reason: "x" } });
    assert.equal(r.leaked, true);
    assert.deepEqual(r.value, { reason: { reason: REMOVED } });
  });

  it("tool desconhecida (sem schema): regra completa, sem isenção", () => {
    const r = redactToolArgs("fooBar", { reason: "x" });
    assert.deepEqual(r, redactReasoningValue({ reason: "x" }));
    assert.equal(r.leaked, true);
  });

  it("submitInterpretation: exatamente a função da V1", () => {
    const input = { ...VALID.C3, thought: "y", entities: { problem: "<reasoning>z</reasoning>" } };
    assert.deepEqual(redactToolArgs("submitInterpretation", input), redactReasoningValue(input));
  });

  it("sem raciocínio: valor intacto, leaked falso", () => {
    const input = { title: "Monitor", description: "Segundo monitor", type: "REQ", category: "HARDWARE", impactAssessment: { affectedScope: "SELF", workImpact: "NONE", commitmentRisk: "NO" } };
    assert.deepEqual(redactToolArgs("proposeTicketDraft", input), { value: input, leaked: false });
  });
});
