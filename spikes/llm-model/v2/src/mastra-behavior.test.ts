// Comportamentos do Mastra 1.81.0 que afetam o instrumento congelado da V2, MEDIDOS pelo caminho real
// do Ollama (model router) com respostas HTTP fabricadas. FORA do manifesto: documenta limitações
// observadas, sem corrigi-las. Nenhum modelo real.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { spikeModels } from "../../src/models.ts";
import { MAX_STEPS, runAttempt } from "./run.ts";
import { checkInvariants } from "./score.ts";
import { VALID, cases } from "./test-helpers.ts";

const completion = (calls: [string, string, unknown][]) => ({
  id: "c",
  object: "chat.completion",
  created: 1,
  model: "f",
  choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: calls.map(([id, name, args]) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } })) }, finish_reason: "tool_calls" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const ok = (body: unknown, headers?: Record<string, string>) => json(200, body, headers);
const e500 = json(500, { error: { message: "boom" } });
const tool = (n: number) => ok(completion([[`L${n}`, "listMyTickets", {}]]));
const submit = ok(completion([["S1", "submitInterpretation", VALID.C3]]));

const ollama = spikeModels().find((m) => m.label === "ollama qwen3:4b-instruct");
assert.ok(ollama);
const input = { model: ollama.config, modelLabel: ollama.label, provider: "ollama" as const, testCase: { ...(cases[0] as (typeof cases)[number]), history: [], input: "x" }, repetition: 1, allowedHosts: ["localhost:11434"] };

async function attemptWith(script: (() => Response)[]) {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => (script[requests++] ?? tool(99))()) as typeof fetch;
  try {
    const { record, error } = await runAttempt(input, 1);
    return { record, error, requests };
  } finally {
    globalThis.fetch = original;
  }
}

describe("passos retry (novas tentativas internas do Mastra) e o maxSteps", () => {
  it(`os passos "retry" NÃO contam no maxSteps (${MAX_STEPS}): 8 passos (3 retry), submissão aceita no passo 7`, async () => {
    const { record, requests } = await attemptWith([tool(1), e500, tool(2), e500, tool(3), e500, tool(4), submit]);
    assert.equal(requests, 8);
    assert.equal(record.status, "completed");
    assert.deepEqual(record.calls.map((c) => `${c.index}:${c.finishReason}`), ["0:tool-calls", "1:retry", "2:tool-calls", "3:retry", "4:tool-calls", "5:retry", "6:tool-calls", "7:tool-calls"]);
    assert.equal(record.calls.length, 8, "mais passos que o maxSteps");
    assert.equal(record.calls.filter((c) => c.finishReason !== "retry").length, MAX_STEPS, "cinco passos não-retry");
    assert.deepEqual(record.terminal, { step: 7, cause: "ACCEPTED" });
    // O onStepFinish dispara também nos passos retry: os passos do protocolo ficam alinhados às chamadas.
    assert.deepEqual(record.steps.map((s) => s.index), [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(record.emitted.map((e) => `${e.step}:${e.toolName}`), ["0:listMyTickets", "2:listMyTickets", "4:listMyTickets", "6:listMyTickets", "7:submitInterpretation"]);
    assert.deepEqual(checkInvariants(record), []);
  });

  it("o limite é atingido com cinco passos não-retry: sem submissão, a tentativa para (7 passos, 2 retry)", async () => {
    const { record, requests } = await attemptWith([tool(1), e500, tool(2), e500, tool(3), tool(4), tool(5), submit]);
    assert.equal(requests, 7, "a submissão do roteiro nunca é pedida");
    assert.deepEqual(record.calls.map((c) => c.finishReason), ["tool-calls", "retry", "tool-calls", "retry", "tool-calls", "tool-calls", "tool-calls"]);
    assert.equal(record.terminal, null);
    assert.deepEqual(checkInvariants(record), []);
  });
});

describe("novas tentativas internas do Mastra por status HTTP", () => {
  it("HTTP 500 persistente: três requisições (duas repetições internas), passos retry, retry, error", async () => {
    const { record, error, requests } = await attemptWith([e500, e500, e500]);
    assert.equal(requests, 3);
    assert.equal(error?.code, "EXEC_PROVIDER_ERROR");
    assert.deepEqual(record.calls.map((c) => c.finishReason), ["retry", "retry", "error"]);
  });

  it("HTTP 401: uma requisição, sem repetição", async () => {
    const { error, requests } = await attemptWith([json(401, { error: { message: "Invalid API Key" } })]);
    assert.equal(requests, 1);
    assert.equal(error?.status, 401);
  });
});

describe("retry interno e a classificação de truncamento (contextCheck)", () => {
  it("500 → retry com tool de negócio → submissão aceita: o passo retry tem inputTokens null e o turno fica UNKNOWN", async () => {
    // Uso informado nas respostas 200 (prompt_tokens 900): a única lacuna é o passo retry.
    const withUsage = (calls: [string, string, unknown][]) => ({ ...completion(calls), usage: { prompt_tokens: 900, completion_tokens: 20, total_tokens: 920 } });
    const { record, requests } = await attemptWith([e500, ok(withUsage([["L1", "listMyTickets", {}]])), ok(withUsage([["S1", "submitInterpretation", VALID.C3]]))]);
    const observed = {
      requests,
      steps: record.calls.map((c) => ({ index: c.index, finishReason: c.finishReason, inputTokens: c.inputTokens })),
      contextCheck: record.contextCheck,
    };
    console.log(`  [medido] ${JSON.stringify(observed)}`);
    assert.equal(requests, 3);
    assert.equal(record.status, "completed");
    assert.deepEqual(observed.steps, [
      { index: 0, finishReason: "retry", inputTokens: null },
      { index: 1, finishReason: "tool-calls", inputTokens: 900 },
      { index: 2, finishReason: "tool-calls", inputTokens: 900 },
    ]);
    assert.deepEqual(record.terminal, { step: 2, cause: "ACCEPTED" });
    // run.ts congelado: unverified = calls.length === 0 || calls.some((c) => c.inputTokens === null),
    // e contextCheckOf devolve UNKNOWN quando unverified (sem DETECTED). Um único retry interno basta.
    assert.equal(record.contextCheck.unverified, true);
    assert.equal(record.contextCheck.overBudget, false);
    assert.equal(record.contextCheck.suspectedSilentTruncation, false);
    assert.equal(record.contextCheck.maxReportedInputTokens, 900);
    assert.equal(record.contextCheck.status, "UNKNOWN");
    assert.deepEqual(checkInvariants(record), []);
  });
});

describe("pausa de 10 s por cabeçalho de limite de taxa", () => {
  it("x-ratelimit-remaining-tokens entre 1 e 1999: o passo espera cerca de 10 s; restante alto ou ausente: sem espera", async () => {
    const started = performance.now();
    await attemptWith([ok(completion([["S1", "submitInterpretation", VALID.C3]]), { "x-ratelimit-remaining-tokens": "1" })]);
    const low = performance.now() - started;
    assert.ok(low >= 9_500, `esperou ${Math.round(low)} ms`);

    const startedHigh = performance.now();
    await attemptWith([ok(completion([["S1", "submitInterpretation", VALID.C3]]), { "x-ratelimit-remaining-tokens": "100000" })]);
    assert.ok(performance.now() - startedHigh < 2_000);

    const startedNone = performance.now();
    await attemptWith([submit]);
    assert.ok(performance.now() - startedNone < 2_000, "sem o cabeçalho (como o servidor local do Ollama): sem espera");
  });
});
