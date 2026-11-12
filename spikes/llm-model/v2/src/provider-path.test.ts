// Premissa de ordem da guarda (v2/CRITERIA.md, "Caminho de execução" e "Guarda de passo").
// 1. Caminhos REAIS do Ollama (model router) e do Groq (@ai-sdk/groq), com respostas HTTP
//    fabricadas: nenhum modelo é chamado; o fetch global devolve respostas no formato
//    chat.completions. Confere que o Agent.generate usa doGenerate (sem stream: true) e que a
//    guarda funciona por esses caminhos.
// 2. doStream do dublê com atraso entre os chunks tool-call: nenhum beforeToolCall antes de a
//    composição do passo estar completa, também com chamadas executadas em paralelo.
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { describe, it } from "node:test";

import { Agent } from "@mastra/core/agent";
import { noopLogger } from "@mastra/core/logger";
import { MastraLanguageModelV2Mock } from "@mastra/core/test-utils/llm-mock";

import { spikeModels } from "../../src/models.ts";
import { REASONING_CONTROL, toMessages } from "../../src/run.ts";
import { createFakeTools } from "../../src/tools.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import { TurnProtocol } from "./protocol.ts";
import type { TurnRecordV2 } from "./record.ts";
import { allowedHostsOf, providerOf, runAttempt } from "./run.ts";
import { checkInvariants, scoreTurnV2 } from "./score.ts";
import { USAGE, VALID, caseById } from "./test-helpers.ts";

type ToolCallSpec = [id: string, name: string, args: unknown];

const completion = (toolCalls: ToolCallSpec[]) => ({
  id: "chatcmpl-fabricado",
  object: "chat.completion",
  created: 1_700_000_000,
  model: "fabricado",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: null, tool_calls: toolCalls.map(([id, name, args]) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } })) },
      finish_reason: "tool_calls",
    },
  ],
  usage: { prompt_tokens: 900, completion_tokens: 20, total_tokens: 920 },
});
const textCompletion = (text: string) => ({ ...completion([]), choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] });

// Substitui o fetch global durante o teste: grava as requisições e devolve as respostas do roteiro.
async function withFabricatedHttp<T>(script: unknown[], fn: () => Promise<T>) {
  const original = globalThis.fetch;
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    const body = script[requests.length - 1] ?? textCompletion("FORA DO ROTEIRO");
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    return { result: await fn(), requests };
  } finally {
    globalThis.fetch = original;
  }
}

const previousKey = process.env["GROQ_API_KEY"];
process.env["GROQ_API_KEY"] = "chave-ficticia-de-teste";
const models = spikeModels();
if (previousKey === undefined) delete process.env["GROQ_API_KEY"];
else process.env["GROQ_API_KEY"] = previousKey;

for (const label of ["ollama qwen3:4b-instruct", "groq openai/gpt-oss-120b"]) {
  const chosen = models.find((m) => m.label === label);
  assert.ok(chosen, label);
  const provider = providerOf(label);
  const input = {
    model: chosen.config,
    modelLabel: label,
    provider,
    testCase: caseById("C3"),
    repetition: 1,
    allowedHosts: allowedHostsOf(provider, chosen.config),
    providerOptions: REASONING_CONTROL[provider].providerOptions,
  };

  describe(`caminho real: ${label} (HTTP fabricado)`, () => {
    it("doGenerate (sem stream: true), toolChoice auto, sem response_format; tool de negócio + submissão no mesmo passo: guarda recusa tudo, sem nova requisição", async () => {
      const { result, requests } = await withFabricatedHttp(
        [completion([["L1", "listMyTickets", {}], ["S1", "submitInterpretation", VALID.C3]])],
        () => runAttempt(input, 1),
      );
      const { record, error } = result;
      assert.equal(error, null, JSON.stringify(error));
      assert.equal(requests.length, 1, "nenhuma geração depois do passo violado");
      const body = requests[0]?.body ?? {};
      assert.notEqual(body["stream"], true, "o Agent.generate usa doGenerate");
      assert.equal(body["tool_choice"], "auto");
      assert.equal("response_format" in body, false, "sem saída estruturada nativa");
      const toolNames = (body["tools"] as { function: { name: string } }[]).map((t) => t.function.name).sort();
      assert.deepEqual(toolNames, ["listMyTickets", "proposeTicketDraft", "requestHandoff", "searchArticles", "submitInterpretation"]);
      if (provider === "ollama") assert.equal(body["reasoning_effort"], "none", "REASONING_CONTROL da V1");
      if (provider === "groq") assert.equal(body["reasoning_format"], "hidden", "REASONING_CONTROL da V1");
      assert.deepEqual(record.executions.map((e) => `${e.toolName}:${e.outcome}`), ["listMyTickets:GUARD_REFUSED", "submitInterpretation:GUARD_REFUSED"]);
      assert.equal(record.toolLog.length, 0);
      assert.deepEqual(record.emitted.map((e) => e.toolCallId), ["L1", "S1"], "toolCallId do provider preservado");
      assert.deepEqual(checkInvariants(record), []);
      assert.deepEqual(record.externalRequests, []);
    });

    it("negócio → submissão: duas requisições, submissão aceita, protocolo correto", async () => {
      const { result, requests } = await withFabricatedHttp(
        [completion([["L1", "listMyTickets", {}]]), completion([["S1", "submitInterpretation", VALID.C3]])],
        () => runAttempt(input, 1),
      );
      const { record, error } = result;
      assert.equal(error, null, JSON.stringify(error));
      assert.equal(requests.length, 2);
      assert.deepEqual(record.terminal, { step: 1, cause: "ACCEPTED" });
      assert.deepEqual(checkInvariants(record), []);
      assert.equal(scoreTurnV2(record, caseById("C3")).protocolCorrect, true);
    });
  });
}

// Monta um registro mínimo a partir do protocolo, para conferir as invariantes fora do runAttempt.
function recordFrom(protocol: TurnProtocol, toolLog: { tool: string; args: unknown }[]): TurnRecordV2 {
  return {
    type: "turn", experiment: "v2", model: "dublê", provider: "mock", caseId: "C3", repetition: 1, startedAt: "", status: "completed",
    execError: null, attempts: 1, rateLimits: [], previousAttempts: [], emitted: protocol.emitted, steps: protocol.steps(),
    executions: protocol.executions, acceptedSubmissions: protocol.acceptedSubmissions, terminal: protocol.terminal,
    toolLog: toolLog.map((e) => ({ tool: e.tool, args: e.args })), finalText: "", reasoning: { separatePresent: false, leakedInText: false, leakedInArgs: false },
    calls: protocol.steps().map((s) => ({ index: s.index, inputTokens: 1, outputTokens: 1, latencyMs: 0, finishReason: "tool-calls" })),
    totalInputTokens: 1, totalOutputTokens: 1, turnLatencyMs: 0, finishReason: null,
    contextCheck: { status: "NOT_DETECTED", budget: 7680, maxReportedInputTokens: 1, estimatedInputTokens: 1, overBudget: false, suspectedSilentTruncation: false, unverified: false },
    externalRequests: [],
  };
}

// doStream do dublê com atraso entre os chunks tool-call; agent.stream com ou sem execução antecipada.
async function delayedStreamTurn(eagerToolExecution: boolean) {
  const timeline: { t: number; event: string }[] = [];
  const mark = (event: string) => timeline.push({ t: performance.now(), event });
  let streams = 0;
  const model = new MastraLanguageModelV2Mock({
      doStream: (async () => {
        streams += 1;
        return {
          stream: new ReadableStream({
            async start(controller) {
              controller.enqueue({ type: "stream-start", warnings: [] });
              controller.enqueue({ type: "tool-call", toolCallId: "L1", toolName: "listMyTickets", input: "{}" });
              await delay(80);
              controller.enqueue({ type: "tool-call", toolCallId: "A1", toolName: "searchArticles", input: JSON.stringify({ query: "vpn" }) });
              await delay(80);
              controller.enqueue({ type: "tool-call", toolCallId: "S1", toolName: "submitInterpretation", input: JSON.stringify(VALID.C3) });
              controller.enqueue({ type: "finish", finishReason: "tool-calls", usage: USAGE });
              controller.close();
            },
          }),
        };
      }) as never,
    });
    const protocol = new TurnProtocol();
    const { tools, calls: toolLog } = createFakeTools();
    const agent = new Agent({ id: "v2-stream", name: "v2-stream", instructions: SYSTEM_PROMPT, model, tools: { ...tools, submitInterpretation: protocol.submitTool } });
    agent.__setLogger(noopLogger);
    const output = await agent.stream(toMessages(caseById("C3")), {
      maxSteps: 5,
      toolChoice: "auto",
      modelSettings: { maxRetries: 0 },
      eagerToolExecution,
      stopWhen: protocol.stopWhen,
      onChunk: (chunk: { type: string; payload?: { toolName?: string } }) => {
        if (chunk.type === "tool-call") mark(`chunk:${chunk.payload?.toolName}`);
        protocol.onChunk(chunk);
      },
      onStepFinish: () => protocol.onStepFinish(),
      hooks: {
        beforeToolCall: (ctx: Parameters<TurnProtocol["beforeToolCall"]>[0]) => {
          mark(`before:${ctx.toolName}`);
          return protocol.beforeToolCall(ctx);
        },
        afterToolCall: protocol.afterToolCall,
      },
    } as never);
  await (output as { getFullOutput: () => Promise<unknown> }).getFullOutput();
  const chunks = timeline.filter((e) => e.event.startsWith("chunk:"));
  const befores = timeline.filter((e) => e.event.startsWith("before:"));
  return { protocol, toolLog, timeline, chunks, befores, streams };
}

describe("doStream com atraso entre os chunks tool-call", () => {
  it("agendamento do Agent.generate (sem execução antecipada): nenhum beforeToolCall antes da composição completa; as três chamadas, em paralelo, recusadas", async () => {
    const { protocol, toolLog, timeline, chunks, befores, streams } = await delayedStreamTurn(false);
    assert.equal(streams, 1, "nenhuma geração depois do passo violado");
    assert.equal(chunks.length, 3);
    assert.equal(befores.length, 3, "um beforeToolCall por chamada conhecida");
    assert.ok((chunks[2]?.t ?? 0) - (chunks[0]?.t ?? 0) >= 150, "o atraso entre os chunks aconteceu");
    const lastChunk = Math.max(...chunks.map((e) => e.t));
    const firstBefore = Math.min(...befores.map((e) => e.t));
    assert.ok(lastChunk <= firstBefore, `beforeToolCall antes da composição completa: ${JSON.stringify(timeline.map((e) => e.event))}`);
    assert.deepEqual(protocol.executions.map((e) => `${e.toolName}:${e.outcome}`).sort(), ["listMyTickets:GUARD_REFUSED", "searchArticles:GUARD_REFUSED", "submitInterpretation:GUARD_REFUSED"]);
    assert.equal(toolLog.length, 0, "nenhuma tool de negócio executou");
    assert.deepEqual(checkInvariants(recordFrom(protocol, toolLog)), []);
  });

  it("Agent.stream com execução antecipada (padrão do stream): a premissa quebra e as invariantes I2 e I5 detectam", async () => {
    const { protocol, toolLog, chunks, befores } = await delayedStreamTurn(true);
    assert.ok(Math.min(...befores.map((e) => e.t)) < Math.max(...chunks.map((e) => e.t)), "o hook disparou antes do último chunk");
    assert.ok(toolLog.length > 0, "tool de negócio executou antes de a submissão chegar");
    const invariants = checkInvariants(recordFrom(protocol, toolLog)).map((v) => v.invariant);
    assert.ok(invariants.includes("I2"), `I2 esperada: ${invariants.join(", ")}`);
    assert.ok(invariants.includes("I5"), `I5 esperada: ${invariants.join(", ")}`);
  });
});
