// Regressões da reconciliação (I4: B1, B2, B3), do `rejected` da vista V1, do desfecho THREW, das
// tentativas anteriores (I2, I4) e do digest do Ollama. Cada regra é testada nos dois sentidos:
// dispara quando deve e não dispara quando não deve.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Agent } from "@mastra/core/agent";
import { noopLogger } from "@mastra/core/logger";
import { createTool } from "@mastra/core/tools";

import { TOOL_INPUT_SCHEMAS } from "../../src/tools.ts";
import { TurnProtocol, validityOf } from "./protocol.ts";
import type { EmittedCall, ExecutionEvent, PreviousAttemptV2, TurnRecordV2 } from "./record.ts";
import { ollamaDigest, runAttempt, runTurn } from "./run.ts";
import { invariantReport, mastraValidation, reconcile, scoreTurnV2, toV1View } from "./score.ts";
import { VALID, call, caseById, scripted, toolStep, turnInput } from "./test-helpers.ts";

// Fabricados com a validade calculada como na captura (validityOf sobre o valor dado).
const emit = (step: number, order: number, toolName: string, rawArgs: unknown, toolCallId: string | null = `${toolName}-${order}`): EmittedCall => ({ step, order, toolCallId, toolName, rawArgs, validAtCapture: validityOf(toolName, rawArgs) });
const ev = (e: EmittedCall, outcome: ExecutionEvent["outcome"], args: unknown = e.rawArgs): ExecutionEvent => ({ step: e.step, toolCallId: e.toolCallId, toolName: e.toolName, outcome, args, validAtCapture: validityOf(e.toolName, args) });

function turn(over: Partial<TurnRecordV2>): TurnRecordV2 {
  return {
    type: "turn", experiment: "v2", model: "fabricado", provider: "mock", caseId: "C2", repetition: 1, startedAt: "", status: "completed",
    execError: null, attempts: 1, rateLimits: [], previousAttempts: [], emitted: [], steps: [{ index: 0, verdict: "OK", lateChunks: 0 }],
    executions: [], acceptedSubmissions: [], terminal: null, toolLog: [], finalText: "", reasoning: { separatePresent: false, leakedInText: false, leakedInArgs: false },
    calls: [{ index: 0, inputTokens: 900, outputTokens: 20, latencyMs: 10, finishReason: "tool-calls" }], totalInputTokens: 900, totalOutputTokens: 20,
    turnLatencyMs: 10, finishReason: "tool-calls",
    contextCheck: { status: "NOT_DETECTED", budget: 7680, maxReportedInputTokens: 900, estimatedInputTokens: 900, overBudget: false, suspectedSilentTruncation: false, unverified: false },
    externalRequests: [],
    ...over,
  };
}
const i4 = (r: TurnRecordV2) => invariantReport(r).violations.filter((v) => v.invariant === "I4").map((v) => v.detail);
const diag = (r: TurnRecordV2) => invariantReport(r).diagnostics.map((d) => d.detail);

describe("B1: emissão ↔ evento, nas duas direções", () => {
  const a = emit(0, 0, "searchArticles", { query: "vpn" });

  it("emissão conhecida sem evento em turno concluído: violação", () => {
    const r = turn({ emitted: [a] });
    assert.ok(i4(r).some((d) => d.includes("sem evento")));
  });

  it("a mesma emissão sem evento em turno com EXEC_* (timeout no meio do turno): diagnóstico, sem violação", () => {
    const r = turn({ emitted: [a], toolLog: [{ tool: "searchArticles", args: { query: "vpn" } }], status: "execution_error", execError: { code: "EXEC_TIMEOUT", message: "tempo" } });
    assert.deepEqual(i4(r), []);
    assert.ok(diag(r).some((d) => d.includes("sem evento")));
    assert.ok(diag(r).some((d) => d.includes("registro(s) sem execução correspondente")));
  });

  it("evento sem emissão: violação também em turno com EXEC_*", () => {
    const ghost: ExecutionEvent = { step: 0, toolCallId: "nao-emitida", toolName: "searchArticles", outcome: "EXECUTED", args: { query: "vpn" }, validAtCapture: true };
    for (const status of ["completed", "execution_error"] as const) {
      const r = turn({ status, emitted: [a], executions: [ev(a, "EXECUTED"), ghost], toolLog: [{ tool: "searchArticles", args: { query: "vpn" } }, { tool: "searchArticles", args: { query: "vpn" } }] });
      assert.ok(i4(r).some((d) => d.includes("sem emissão correspondente")), status);
    }
  });

  it("toda emissão com exatamente um evento: sem violação", () => {
    const r = turn({ emitted: [a], executions: [ev(a, "EXECUTED")], toolLog: [{ tool: "searchArticles", args: { query: "vpn" } }] });
    assert.deepEqual(i4(r), []);
  });
});

describe("B2: argumentos no caminho (passo, toolCallId)", () => {
  it("mesmo id, argumentos divergentes: violação", () => {
    const a = emit(0, 0, "searchArticles", { query: "vpn" });
    const r = turn({ emitted: [a], executions: [ev(a, "EXECUTED", { query: "wifi" })], toolLog: [{ tool: "searchArticles", args: { query: "wifi" } }] });
    assert.ok(i4(r).some((d) => d.includes("argumentos do evento divergem da emissão")));
  });

  it("mesmo id, crus diferentes que coagem para o mesmo valor: violação (emissão e evento são crus; sem coerção na B2)", () => {
    const a = emit(0, 0, "searchArticles", { query: "vpn", extra: null });
    const r = turn({ emitted: [a], executions: [ev(a, "EXECUTED", { query: "vpn" })], toolLog: [{ tool: "searchArticles", args: { query: "vpn" } }] });
    assert.ok(i4(r).some((d) => d.includes("argumentos do evento divergem da emissão")));
  });

  it("mesmo id, dois argumentos INVÁLIDOS diferentes: violação (ser inválido não autoriza a divergência)", () => {
    const a = emit(0, 0, "searchArticles", { query: "" });
    const r = turn({ emitted: [a], executions: [ev(a, "MASTRA_REFUSED", { query: "", foo: 1 })] });
    assert.equal(a.validAtCapture, false);
    assert.ok(i4(r).some((d) => d.includes("argumentos do evento divergem da emissão")));
  });

  it("mesmo id, mesmo argumento inválido nos dois lados: sem violação", () => {
    const a = emit(0, 0, "searchArticles", { query: "" });
    const r = turn({ emitted: [a], executions: [ev(a, "MASTRA_REFUSED")] });
    assert.deepEqual(i4(r), []);
  });
});

describe("B3: toolLog × execuções, pela forma coagida", () => {
  const a = emit(0, 0, "searchArticles", { query: "vpn", extra: null });

  it("toolLog com argumentos divergentes: violação", () => {
    const r = turn({ emitted: [a], executions: [ev(a, "EXECUTED")], toolLog: [{ tool: "searchArticles", args: { query: "wifi" } }] });
    assert.ok(i4(r).some((d) => d.startsWith("C2, repetição 1: toolLog: 1 execução(ões) e 0 registro(s)")));
  });

  it("toolLog com a forma coagida e evento com a forma crua: sem violação (formas equivalentes)", () => {
    const r = turn({ emitted: [a], executions: [ev(a, "EXECUTED")], toolLog: [{ tool: "searchArticles", args: { query: "vpn" } }] });
    assert.deepEqual(i4(r), []);
  });
});

describe("chamada coagida pelo Mastra, com e sem toolCallId: sem violação de I4", () => {
  it("com toolCallId, pelo Agent (dublê): searchArticles com campo extra nulo, depois a submissão", async () => {
    const interpretation = { intent: "ANSWER_KB", confidence: "HIGH", entities: { operatingSystem: "Windows 10" }, missingFields: [] };
    const { model } = scripted([toolStep(call("searchArticles", { query: "vpn 809", extra: null }, "A1")), toolStep(call("submitInterpretation", interpretation, "S1"))]);
    const { record } = await runAttempt(turnInput("C2", model), 1);
    assert.deepEqual(record.toolLog, [{ tool: "searchArticles", args: { query: "vpn 809" } }], "o toolLog tem a forma coagida");
    assert.deepEqual(record.executions[0]?.args, { query: "vpn 809", extra: null }, "o evento tem a forma crua");
    assert.deepEqual(invariantReport(record), { violations: [], diagnostics: [] });
    assert.equal(reconcile(record).mode, "toolCallId");
  });

  it("sem toolCallId (multiconjunto): mesma coerção, sem violação", () => {
    const a = emit(0, 0, "searchArticles", { query: "vpn", extra: null }, null);
    const r = turn({ emitted: [a], executions: [ev(a, "EXECUTED")], toolLog: [{ tool: "searchArticles", args: { query: "vpn" } }] });
    assert.equal(reconcile(r).mode, "multiset");
    assert.deepEqual(i4(r), []);
  });
});

describe("ids ausentes ou repetidos", () => {
  it("ids ausentes: multiconjunto, sem violação", () => {
    const a = emit(0, 0, "searchArticles", { query: "vpn" }, null);
    const b = emit(0, 1, "listMyTickets", {}, null);
    const r = turn({ emitted: [a, b], executions: [ev(a, "EXECUTED"), ev(b, "EXECUTED")], toolLog: [{ tool: "searchArticles", args: { query: "vpn" } }, { tool: "listMyTickets", args: {} }] });
    assert.equal(reconcile(r).mode, "multiset");
    assert.deepEqual(i4(r), []);
  });

  it("sem id, crus diferentes que coagem para o mesmo valor: violação (chave do multiconjunto = JSON canônico cru)", () => {
    const a = emit(0, 0, "searchArticles", { query: "vpn", extra: null }, null);
    const r = turn({ emitted: [a], executions: [ev(a, "EXECUTED", { query: "vpn" })], toolLog: [{ tool: "searchArticles", args: { query: "vpn" } }] });
    assert.equal(reconcile(r).mode, "multiset");
    assert.ok(i4(r).some((d) => d.startsWith("C2, repetição 1: multiconjunto: 1 evento(s) para 0 emissão(ões)")));
  });

  it("id repetido com argumentos iguais: multiconjunto sem deduplicação, sem violação", () => {
    const a = emit(0, 0, "searchArticles", { query: "vpn" }, "X");
    const b = emit(0, 1, "searchArticles", { query: "vpn" }, "X");
    const r = turn({ emitted: [a, b], executions: [ev(a, "EXECUTED"), ev(b, "EXECUTED")], toolLog: [{ tool: "searchArticles", args: { query: "vpn" } }, { tool: "searchArticles", args: { query: "vpn" } }] });
    assert.equal(reconcile(r).mode, "multiset");
    assert.deepEqual(i4(r), []);
  });

  it("id repetido com argumentos diferentes: sem violação quando as execuções batem; violação quando não batem", () => {
    const a = emit(0, 0, "searchArticles", { query: "vpn" }, "X");
    const b = emit(0, 1, "searchArticles", { query: "wifi" }, "X");
    const ok = turn({ emitted: [a, b], executions: [ev(a, "EXECUTED"), ev(b, "EXECUTED")], toolLog: [{ tool: "searchArticles", args: { query: "vpn" } }, { tool: "searchArticles", args: { query: "wifi" } }] });
    assert.deepEqual(i4(ok), []);
    const bad = turn({ emitted: [a, b], executions: [ev(a, "EXECUTED"), ev(a, "EXECUTED")], toolLog: [{ tool: "searchArticles", args: { query: "vpn" } }, { tool: "searchArticles", args: { query: "vpn" } }] });
    assert.ok(i4(bad).some((d) => d.includes("multiconjunto: 2 evento(s) para 1 emissão(ões)")));
  });
});

describe("guarda recusando, com argumentos válidos e inválidos (pelo Agent, dublê)", () => {
  it("argumentos válidos: rejected = false na vista V1; I4 sem violação", async () => {
    const { model } = scripted([toolStep(call("listMyTickets", {}, "L1"), call("submitInterpretation", VALID.C3, "S1"))]);
    const { record } = await runAttempt(turnInput("C3", model), 1);
    assert.deepEqual(record.executions.map((e) => e.outcome), ["GUARD_REFUSED", "GUARD_REFUSED"]);
    assert.equal(toV1View(record).businessToolCalls[0]?.rejected, false);
    assert.deepEqual(invariantReport(record), { violations: [], diagnostics: [] });
  });

  it("argumentos inválidos (identidade proibida): rejected = true na vista V1; I4 sem violação", async () => {
    const { model } = scripted([toolStep(call("listMyTickets", { userId: "E-1" }, "L1"), call("submitInterpretation", VALID.C3, "S1"))]);
    const { record } = await runAttempt(turnInput("C3", model), 1);
    assert.deepEqual(record.executions.map((e) => e.outcome), ["GUARD_REFUSED", "GUARD_REFUSED"], "a guarda decide antes da validação do Mastra");
    assert.equal(toV1View(record).businessToolCalls[0]?.rejected, true);
    assert.deepEqual(invariantReport(record), { violations: [], diagnostics: [] });
  });
});

describe("rejected calculado sempre por validateToolInput; desfecho do evento conferido na I4", () => {
  const valid = emit(0, 0, "searchArticles", { query: "vpn" });
  const invalid = emit(0, 0, "searchArticles", { query: "" });

  it("MASTRA_REFUSED com argumentos válidos: inconsistência (violação)", () => {
    const r = turn({ emitted: [valid], executions: [ev(valid, "MASTRA_REFUSED")] });
    assert.ok(i4(r).some((d) => d.includes("recusada pelo Mastra, mas validateToolInput aceitou os argumentos na captura")));
    assert.equal(toV1View(r).businessToolCalls[0]?.rejected, false, "o rejected segue a validação, não o evento");
  });

  it("EXECUTED com argumentos inválidos: inconsistência (violação)", () => {
    const r = turn({ emitted: [invalid], executions: [ev(invalid, "EXECUTED")], toolLog: [{ tool: "searchArticles", args: { query: "" } }] });
    assert.ok(i4(r).some((d) => d.includes("executada, mas validateToolInput recusou os argumentos na captura")));
  });

  it("MASTRA_REFUSED com argumentos inválidos: consistente (sem violação); rejected = true", () => {
    const r = turn({ emitted: [invalid], executions: [ev(invalid, "MASTRA_REFUSED")] });
    assert.deepEqual(i4(r), []);
    assert.equal(toV1View(r).businessToolCalls[0]?.rejected, true);
  });
});

describe("afterToolCall com erro: desfecho THREW", () => {
  it("execute que lança é registrado como THREW, com a mensagem sanitizada, e não como EXECUTED", async () => {
    const protocol = new TurnProtocol();
    const boom = createTool({
      id: "listMyTickets",
      description: "x",
      inputSchema: TOOL_INPUT_SCHEMAS.listMyTickets,
      execute: async () => {
        throw new Error("falhou com gsk_segredo123");
      },
    });
    const { model } = scripted([toolStep(call("listMyTickets", {}, "L1")), toolStep(call("submitInterpretation", VALID.C3, "S1"))]);
    const agent = new Agent({ id: "t", name: "t", instructions: "t", model, tools: { listMyTickets: boom, submitInterpretation: protocol.submitTool } });
    agent.__setLogger(noopLogger);
    await agent.generate("oi", { maxSteps: 5, stopWhen: protocol.stopWhen, hooks: protocol.hooks, onChunk: protocol.onChunk, onStepFinish: protocol.onStepFinish } as never);
    const threw = protocol.executions.find((e) => e.toolName === "listMyTickets");
    assert.equal(threw?.outcome, "THREW");
    assert.match(threw?.error ?? "", /falhou com \[redacted\]/);
    assert.equal(protocol.executions.some((e) => e.toolName === "listMyTickets" && e.outcome === "EXECUTED"), false);
  });

  it("THREW com registro na tool falsa: aceito pela B3 (o execute pode ter registrado e lançado); THREW em passo violado: I2", () => {
    const a = emit(0, 0, "listMyTickets", {});
    const ok = turn({ caseId: "C3", emitted: [a], executions: [ev(a, "THREW")], toolLog: [{ tool: "listMyTickets", args: {} }] });
    assert.deepEqual(i4(ok), []);
    const s = emit(0, 1, "submitInterpretation", VALID.C3);
    const violated = turn({ caseId: "C3", emitted: [a, s], executions: [ev(a, "THREW"), ev(s, "GUARD_REFUSED")], terminal: { step: 0, cause: "VIOLATION" } });
    assert.ok(invariantReport(violated).violations.some((v) => v.invariant === "I2"));
  });
});

describe("tentativas anteriores (interrompidas por 429): I2 e I4 conferidas", () => {
  const prev = (over: Partial<PreviousAttemptV2>): PreviousAttemptV2 => ({
    attempt: 1, error: { code: "EXEC_RATE_LIMIT", message: "429", status: 429 }, emitted: [], steps: [], executions: [], acceptedSubmissions: [], terminal: null, toolLog: [], calls: [], ...over,
  });

  it("tool de negócio executada em passo violado na tentativa 1: I2", () => {
    const a = emit(0, 0, "listMyTickets", {});
    const s = emit(0, 1, "submitInterpretation", VALID.C3);
    const r = turn({ previousAttempts: [prev({ emitted: [a, s], executions: [ev(a, "EXECUTED"), ev(s, "GUARD_REFUSED")], toolLog: [{ tool: "listMyTickets", args: {} }] })] });
    assert.ok(invariantReport(r).violations.some((v) => v.invariant === "I2" && v.detail.includes("(tentativa 1)")));
  });

  it("emissão sem evento na tentativa 1 (interrompida): diagnóstico; evento sem emissão: violação", () => {
    const a = emit(0, 0, "listMyTickets", {});
    const pending = turn({ previousAttempts: [prev({ emitted: [a] })] });
    assert.deepEqual(invariantReport(pending).violations, []);
    assert.ok(invariantReport(pending).diagnostics.some((d) => d.detail.includes("(tentativa 1)") && d.detail.includes("sem evento")));
    const ghost = turn({ previousAttempts: [prev({ executions: [ev(a, "EXECUTED")], toolLog: [{ tool: "listMyTickets", args: {} }] })] });
    assert.ok(invariantReport(ghost).violations.some((v) => v.invariant === "I4" && v.detail.includes("(tentativa 1)")));
  });
});

describe("digest da imagem Ollama (cabeçalho)", () => {
  const fakeFetch = (body: unknown, seen: string[]) => (async (url: string) => {
    seen.push(url);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;

  it("lido de /api/tags do mesmo servidor (sem o /v1)", async () => {
    const seen: string[] = [];
    const digest = await ollamaDigest("http://localhost:11434/v1", "qwen3:4b-instruct", fakeFetch({ models: [{ name: "qwen3:8b", digest: "aaa" }, { name: "qwen3:4b-instruct", digest: "bbb" }] }, seen));
    assert.equal(digest, "bbb");
    assert.deepEqual(seen, ["http://localhost:11434/api/tags"]);
  });

  it("modelo ausente da lista: null", async () => {
    assert.equal(await ollamaDigest("http://localhost:11434/v1", "qwen3:4b-instruct", fakeFetch({ models: [] }, [])), null);
  });
});

describe("validade na captura (validAtCapture): calculada sobre o valor original, antes da remoção de raciocínio", () => {
  it("argumento com raciocínio cuja remoção muda a validade: sem violação de I4, com SEM_REASONING_LEAK", async () => {
    // entities em texto JSON com <think> NÃO fechado: o original é válido (o Mastra converte o texto
    // em objeto). A remoção apaga de <think> até o fim do texto, o JSON quebra e o valor gravado
    // fica INVÁLIDO. Sem a validade da captura, a checagem cruzada acusaria um falso "executada,
    // mas inválida".
    const original = { ...VALID.C3, entities: '{"problem":"<think>ver chamados"}' };
    const { model } = scripted([toolStep(call("submitInterpretation", original, "S1"))]);
    const { record } = await runAttempt(turnInput("C3", model), 1);
    const emitted = record.emitted[0];
    assert.equal(emitted?.validAtCapture, true, "validade do valor original");
    assert.equal(mastraValidation("submitInterpretation", emitted?.rawArgs).valid, false, "o valor gravado (sem raciocínio) seria inválido");
    assert.equal(JSON.stringify(record).includes("ver chamados"), false, "conteúdo nunca gravado");
    assert.equal(record.executions[0]?.outcome, "EXECUTED");
    assert.equal(record.executions[0]?.validAtCapture, true);
    assert.deepEqual(invariantReport(record).violations, [], "desfecho consistente com a validade original");
    const score = scoreTurnV2(record, caseById("C3"));
    assert.ok(score.codes.includes("SEM_REASONING_LEAK"));
    assert.ok(score.codes.includes("SEM_INVALID_INTERPRETATION"), "Zod estrito sobre o cru gravado (texto, não objeto)");
  });

  it("requestHandoff { reason: 42 }: reason é caminho declarado (isento da regra por chave): gravado intacto, sem vazamento, rejected pela validade", async () => {
    const { model } = scripted([toolStep(call("requestHandoff", { reason: 42 }, "H1")), toolStep(call("submitInterpretation", VALID.C5, "S1"))]);
    const { record } = await runAttempt(turnInput("C5", model), 1);
    assert.deepEqual(record.emitted[0]?.rawArgs, { reason: 42 });
    assert.equal(record.emitted[0]?.validAtCapture, false);
    assert.equal(record.executions[0]?.outcome, "MASTRA_REFUSED");
    assert.equal(record.reasoning.leakedInArgs, false);
    assert.deepEqual(invariantReport(record).violations, []);
    assert.equal(toV1View(record).businessToolCalls[0]?.rejected, true);
    assert.ok(scoreTurnV2(record, caseById("C5")).codes.includes("SEM_WRONG_TOOL_ARGS"));
  });
});

describe("tentativas anteriores: I1, I3 e I5 (além de I2 e I4)", () => {
  const prev = (over: Partial<PreviousAttemptV2>): PreviousAttemptV2 => ({
    attempt: 1, error: { code: "EXEC_RATE_LIMIT", message: "429", status: 429 }, emitted: [], steps: [], executions: [], acceptedSubmissions: [], terminal: null, toolLog: [], calls: [], ...over,
  });
  const call0 = { index: 0, inputTokens: 1, outputTokens: 1, latencyMs: 1, finishReason: "tool-calls" };

  it("I1: submissão aceita seguida de 429 (geração depois do aceite) na tentativa 1", () => {
    const s = emit(0, 0, "submitInterpretation", VALID.C3);
    const p = prev({ emitted: [s], executions: [ev(s, "EXECUTED")], acceptedSubmissions: [{ step: 0, toolCallId: s.toolCallId }], terminal: { step: 0, cause: "ACCEPTED" },
      steps: [{ index: 0, verdict: "OK", lateChunks: 0 }, { index: 1, verdict: null, lateChunks: 0 }], calls: [call0, { ...call0, index: 1, finishReason: "error" }] });
    const v = invariantReport(turn({ previousAttempts: [p] })).violations;
    assert.ok(v.some((x) => x.invariant === "I1" && x.detail.includes("(tentativa 1)")), JSON.stringify(v));
  });

  it("I3: duas submissões aceitas na tentativa 1", () => {
    const s = emit(0, 0, "submitInterpretation", VALID.C3);
    const p = prev({ emitted: [s], executions: [ev(s, "EXECUTED")], acceptedSubmissions: [{ step: 0, toolCallId: s.toolCallId }, { step: 0, toolCallId: s.toolCallId }], steps: [{ index: 0, verdict: "OK", lateChunks: 0 }], calls: [call0] });
    assert.ok(invariantReport(turn({ previousAttempts: [p] })).violations.some((x) => x.invariant === "I3" && x.detail.includes("(tentativa 1)")));
  });

  it("I5: chunk depois do selo na tentativa 1", () => {
    const p = prev({ steps: [{ index: 0, verdict: "OK", lateChunks: 1 }], calls: [call0] });
    assert.ok(invariantReport(turn({ previousAttempts: [p] })).violations.some((x) => x.invariant === "I5" && x.detail.includes("(tentativa 1)")));
  });

  it("tentativa anterior limpa (tool executada, depois 429): sem violação; o runTurn guarda terminal e passos", async () => {
    const { MastraLanguageModelV2Mock } = await import("@mastra/core/test-utils/llm-mock");
    let n = 0;
    const steps: (() => unknown)[] = [
      () => toolStep(call("listMyTickets", {}, "L1")),
      () => { throw Object.assign(new Error("Rate limit reached: tokens per minute (TPM)"), { name: "AI_APICallError", statusCode: 429, responseHeaders: { "retry-after": "1" }, responseBody: "TPM" }); },
      () => toolStep(call("listMyTickets", {}, "L2")),
      () => toolStep(call("submitInterpretation", VALID.C3, "S2")),
    ];
    const model = new MastraLanguageModelV2Mock({ doGenerate: (async () => (steps[n++] as () => unknown)()) as never });
    const record = await runTurn(turnInput("C3", model));
    assert.equal(record.attempts, 2);
    const p = record.previousAttempts[0];
    assert.equal(p?.terminal, null);
    // A geração que falhou com 429 também é um passo (onStepFinish com finishReason "error"):
    // é o que permite à I1 detectar "aceite seguido de 429".
    assert.equal(p?.steps.length, 2);
    assert.deepEqual(p?.calls.map((c) => c.finishReason), ["tool-calls", "error"]);
    assert.equal(p?.toolLog.length, 1);
    assert.deepEqual(invariantReport(record).violations, []);
  });
});

describe("I1: chamadas posteriores ao término contadas pelo índice, não pela posição", () => {
  const callAt = (index: number) => ({ index, inputTokens: 1, outputTokens: 1, latencyMs: 1, finishReason: "tool-calls" });
  const acceptedAt2 = () => {
    const s = emit(2, 0, "submitInterpretation", VALID.C3);
    return { emitted: [s], executions: [ev(s, "EXECUTED")], acceptedSubmissions: [{ step: 2, toolCallId: s.toolCallId }], terminal: { step: 2, cause: "ACCEPTED" as const }, steps: [{ index: 2, verdict: "OK" as const, lateChunks: 0 }] };
  };

  it("índices não contíguos [2, 7] com término no passo 2: a I1 detecta a chamada 7 (a contagem posicional dava 2 − 3 < 0)", () => {
    const r = turn({ caseId: "C3", ...acceptedAt2(), calls: [callAt(2), callAt(7)] });
    const v = invariantReport(r).violations;
    assert.deepEqual(v.map((x) => x.invariant), ["I1"], JSON.stringify(v));
    const detail = v[0]?.detail ?? "";
    assert.ok(detail.includes("1 geração(ões) e 0 emissão(ões) depois do passo 2"), detail);
  });

  it("índices não contíguos [2] com término no passo 2: nenhuma chamada posterior, sem I1", () => {
    const r = turn({ caseId: "C3", ...acceptedAt2(), calls: [callAt(2)] });
    assert.deepEqual(invariantReport(r).violations, []);
  });

  it("índices contíguos [0, 1, 2] com término no passo 2: sem I1", () => {
    const r = turn({ caseId: "C3", ...acceptedAt2(), calls: [callAt(0), callAt(1), callAt(2)] });
    assert.deepEqual(invariantReport(r).violations, []);
  });
});
