// Ciclo do Agent com a submitInterpretation, pelo run.ts da V2, com o dublê do Mastra (doGenerate,
// o caminho do Agent.generate). Sem modelo real. Rodar, em spikes/llm-model/:
//   node --test v2/src/*.test.ts
// Todo teste confere também as invariantes do instrumento (I1–I5) no registro produzido.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runAttempt } from "./run.ts";
import { checkInvariants, reconcile, scoreTurnV2, toV1View } from "./score.ts";
import { AFTER_SCRIPT, VALID, call, caseById, scripted, textStep, toolStep, turnInput } from "./test-helpers.ts";
import type { TurnRecordV2 } from "./record.ts";

async function turn(caseId: string, responses: unknown[]) {
  const { model, state } = scripted(responses);
  const { record, error } = await runAttempt(turnInput(caseId, model), 1);
  assert.equal(error, null, JSON.stringify(error));
  assert.deepEqual(checkInvariants(record), [], "invariantes do instrumento");
  assert.equal(record.finalText.includes(AFTER_SCRIPT), false, "nenhuma geração fora do roteiro");
  return { record, generations: state.generations, score: scoreTurnV2(record, caseById(caseId)) };
}

const outcomes = (record: TurnRecordV2) => record.executions.map((e) => `${e.toolName}:${e.toolCallId}:${e.outcome}`);
const protocolCodes = (codes: readonly string[]) => codes.filter((c) => c.startsWith("SEM_PROTOCOL") || c === "SEM_INVALID_INTERPRETATION").sort();

describe("passos válidos", () => {
  it("(a) negócio → submissão sozinha: aceita, sem geração depois, todas as métricas corretas (C3)", async () => {
    const { record, generations, score } = await turn("C3", [toolStep(call("listMyTickets", {}, "L1")), toolStep(call("submitInterpretation", VALID.C3, "S1"))]);
    assert.equal(generations, 2);
    assert.deepEqual(outcomes(record), ["listMyTickets:L1:EXECUTED", "submitInterpretation:S1:EXECUTED"]);
    assert.deepEqual(record.terminal, { step: 1, cause: "ACCEPTED" });
    assert.deepEqual(record.acceptedSubmissions, [{ step: 1, toolCallId: "S1" }]);
    assert.equal(score.protocolCorrect, true);
    assert.deepEqual(score.codes, []);
    assert.equal(score.v1.zodValid && score.v1.intentCorrect && score.v1.toolCorrect && score.v1.entitiesCorrect, true);
  });

  it("C6: submissão sozinha, sem tool de negócio", async () => {
    const { generations, score } = await turn("C6", [toolStep(call("submitInterpretation", VALID.C6, "S1"))]);
    assert.equal(generations, 1);
    assert.equal(score.protocolCorrect, true);
    assert.equal(score.v1.c6Expected, true);
    assert.equal(score.v1.toolCorrect, true);
  });

  it("duas tools de negócio em paralelo no mesmo passo, depois a submissão: executam e o protocolo é correto", async () => {
    const { record, generations, score } = await turn("C3", [
      toolStep(call("listMyTickets", {}, "L1"), call("listMyTickets", {}, "L2")),
      toolStep(call("submitInterpretation", VALID.C3, "S1")),
    ]);
    assert.equal(generations, 2);
    assert.equal(record.toolLog.length, 2);
    assert.equal(score.protocolCorrect, true);
    assert.equal(score.v1.toolCorrect, true, "repetir a chamada válida não reprova (V1)");
  });
});

describe("passos violados (guarda pela composição completa)", () => {
  it("(b) negócio → negócio + submissão: o segundo passo é todo recusado; o primeiro executou", async () => {
    const { record, generations, score } = await turn("C3", [
      toolStep(call("listMyTickets", {}, "L1")),
      toolStep(call("listMyTickets", {}, "L2"), call("submitInterpretation", VALID.C3, "S1")),
    ]);
    assert.equal(generations, 2, "nenhuma geração depois do passo violado");
    assert.deepEqual(outcomes(record), ["listMyTickets:L1:EXECUTED", "listMyTickets:L2:GUARD_REFUSED", "submitInterpretation:S1:GUARD_REFUSED"]);
    assert.equal(record.toolLog.length, 1, "a tool de negócio do passo violado não executou");
    assert.deepEqual(record.terminal, { step: 1, cause: "VIOLATION" });
    assert.deepEqual(record.acceptedSubmissions, []);
    assert.equal(score.protocolCorrect, false);
    assert.deepEqual(protocolCodes(score.codes), ["SEM_INVALID_INTERPRETATION", "SEM_PROTOCOL_NOT_ACCEPTED", "SEM_PROTOCOL_SAME_STEP"]);
    assert.equal(score.v1.toolCorrect, true, "a recusa da guarda pesa no protocolo, não na escolha da tool");
  });

  it("(c) duas submissões no mesmo passo, em paralelo: nenhuma aceita", async () => {
    const { record, generations, score } = await turn("C3", [
      toolStep(call("submitInterpretation", VALID.C3, "S1"), call("submitInterpretation", { ...VALID.C3, confidence: "LOW" }, "S2")),
    ]);
    assert.equal(generations, 1);
    assert.deepEqual(outcomes(record), ["submitInterpretation:S1:GUARD_REFUSED", "submitInterpretation:S2:GUARD_REFUSED"]);
    assert.deepEqual(record.acceptedSubmissions, []);
    assert.deepEqual(record.terminal, { step: 0, cause: "VIOLATION" });
    assert.deepEqual(protocolCodes(score.codes), ["SEM_INVALID_INTERPRETATION", "SEM_PROTOCOL_MULTIPLE", "SEM_PROTOCOL_NOT_ACCEPTED"]);
  });

  it("nome de tool desconhecido sozinho: nenhum efeito, não passa pelos hooks, o ciclo segue", async () => {
    const { record, generations, score } = await turn("C3", [toolStep(call("fooBar", {}, "U1")), toolStep(call("submitInterpretation", VALID.C3, "S1"))]);
    assert.equal(generations, 2);
    assert.deepEqual(outcomes(record), ["submitInterpretation:S1:EXECUTED"], "o Mastra devolve erro de tool inexistente sem hooks");
    assert.equal(record.toolLog.length, 0);
    assert.equal(score.protocolCorrect, true);
    assert.equal(score.v1.toolCorrect, false);
    assert.ok(score.codes.includes("SEM_WRONG_TOOL"));
  });

  it("nome desconhecido + submissão: nenhuma chamada produz efeito e a submissão é bloqueada pela guarda", async () => {
    const { record, generations, score } = await turn("C3", [toolStep(call("fooBar", {}, "U1"), call("submitInterpretation", VALID.C3, "S1"))]);
    assert.equal(generations, 1);
    assert.deepEqual(outcomes(record), ["submitInterpretation:S1:GUARD_REFUSED"]);
    assert.equal(record.toolLog.length, 0);
    assert.deepEqual(record.terminal, { step: 0, cause: "VIOLATION" });
    assert.deepEqual(protocolCodes(score.codes), ["SEM_INVALID_INTERPRETATION", "SEM_PROTOCOL_NOT_ACCEPTED", "SEM_PROTOCOL_SAME_STEP"]);
  });
});

describe("submissões inválidas e ausentes", () => {
  it("recusada pelo Mastra, depois corrigida: MULTIPLE + INVALID; intenção e entidades só na primeira", async () => {
    const { record, generations, score } = await turn("C3", [
      toolStep(call("submitInterpretation", { ...VALID.C3, intent: "FOO" }, "S1")),
      toolStep(call("submitInterpretation", VALID.C3, "S2")),
    ]);
    assert.equal(generations, 2);
    assert.deepEqual(outcomes(record), ["submitInterpretation:S1:MASTRA_REFUSED", "submitInterpretation:S2:EXECUTED"]);
    assert.deepEqual(record.acceptedSubmissions, [{ step: 1, toolCallId: "S2" }]);
    assert.equal(score.protocolCorrect, false);
    assert.deepEqual(protocolCodes(score.codes), ["SEM_INVALID_INTERPRETATION", "SEM_PROTOCOL_MULTIPLE"]);
    assert.equal(score.v1.zodValid, false);
    assert.equal(score.v1.intentCorrect, false, "a correção válida não é pontuada");
    assert.equal(score.v1.entitiesCorrect, false);
  });

  it("recusada pelo Mastra, sem correção: NOT_ACCEPTED + INVALID", async () => {
    const { generations, score } = await turn("C3", [toolStep(call("submitInterpretation", { ...VALID.C3, intent: "FOO" }, "S1")), textStep("Pronto.")]);
    assert.equal(generations, 2);
    assert.deepEqual(protocolCodes(score.codes), ["SEM_INVALID_INTERPRETATION", "SEM_PROTOCOL_NOT_ACCEPTED"]);
  });

  it("aceita por coerção do Mastra e reprovada pelo Zod estrito: protocolo correto, Zod incorreto, turno encerrado", async () => {
    const coerced = { ...VALID.C3, entities: "{}" };
    const { record, generations, score } = await turn("C3", [toolStep(call("submitInterpretation", coerced, "S1"))]);
    assert.equal(generations, 1);
    assert.deepEqual(record.terminal, { step: 0, cause: "ACCEPTED" });
    assert.deepEqual(record.emitted[0]?.rawArgs, coerced, "argumentos crus, antes da coerção");
    assert.equal(score.protocolCorrect, true);
    assert.equal(score.v1.zodValid, false);
    assert.deepEqual(protocolCodes(score.codes), ["SEM_INVALID_INTERPRETATION"]);
  });

  it("só texto: MISSING + INVALID", async () => {
    const { generations, score } = await turn("C3", [textStep("Posso ajudar com seus chamados.")]);
    assert.equal(generations, 1);
    assert.equal(score.protocolCorrect, false);
    assert.deepEqual(protocolCodes(score.codes), ["SEM_INVALID_INTERPRETATION", "SEM_PROTOCOL_MISSING"]);
  });

  it("maxSteps esgotado só com tools de negócio: exatamente 5 gerações (o stopWhen não anula o maxSteps)", async () => {
    const responses = [1, 2, 3, 4, 5, 6, 7].map((i) => toolStep(call("listMyTickets", {}, `L${i}`)));
    const { record, generations, score } = await turn("C3", responses);
    assert.equal(generations, 5);
    assert.equal(record.toolLog.length, 5);
    assert.equal(record.terminal, null, "o stopWhen nunca encerrou");
    assert.deepEqual(protocolCodes(score.codes), ["SEM_INVALID_INTERPRETATION", "SEM_PROTOCOL_MISSING"]);
  });
});

describe("reconciliação", () => {
  it("regressão do C4 da V1: argumentos em ordem de chaves diferente da do schema → uma chamada, uma execução", async () => {
    const alphabetical = {
      category: "HARDWARE",
      description: "Preciso de um segundo monitor para uso pessoal. Não afeta meu trabalho e não há compromisso em risco.",
      impactAssessment: { affectedScope: "SELF", commitmentRisk: "NO", workImpact: "NONE" },
      title: "Solicitação de segundo monitor",
      type: "REQ",
    };
    const interpretation = { intent: "CREATE_TICKET", confidence: "HIGH", entities: { category: "HARDWARE", impact: { affectedScope: "SELF", workImpact: "NONE", commitmentRisk: "NO" } }, missingFields: [] };
    const { record, score } = await turn("C4", [toolStep(call("proposeTicketDraft", alphabetical, "P1")), toolStep(call("submitInterpretation", interpretation, "S1"))]);
    assert.equal(record.toolLog.length, 1);
    assert.deepEqual(Object.keys(record.toolLog[0]?.args as object), ["title", "description", "type", "category", "impactAssessment"], "o execute recebe a ordem do schema");
    assert.equal(toV1View(record).businessToolCalls.length, 1);
    assert.deepEqual(reconcile(record), { mode: "toolCallId", issues: [], diagnostics: [] });
    assert.equal(score.v1.toolCorrect, true);
  });
});
