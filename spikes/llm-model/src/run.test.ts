// Testes do run.ts sem modelo real. Rodar:
//   node --test src/run.test.ts
// Ponta a ponta: o agent do Mastra roda de verdade, com as tools falsas e a saída estruturada,
// mas o modelo é o dublê roteirizado do Mastra (MastraLanguageModelV2Mock): cada chamada ao
// modelo devolve o próximo item da lista `doGenerate` (o agent.generate usa doGenerate).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { MastraLanguageModelV2Mock } from "@mastra/core/test-utils/llm-mock";

import { casesFileSchema } from "./cases-schema.ts";
import type { RunHeader } from "./run-record.ts";
import {
  classifyError,
  ollamaEnvProblem,
  redactReasoningText,
  redactReasoningValue,
  retriedToolLines,
  runJsonl,
  runModel,
  runTurn,
  summaryMarkdown,
  toMessages,
} from "./run.ts";
import { aggregate, scoreTurn } from "./score.ts";

const cases = casesFileSchema.parse(JSON.parse(readFileSync(new URL("../cases.json", import.meta.url), "utf8"))).cases;
const caseById = (id: string) => {
  const found = cases.find((c) => c.id === id);
  if (found === undefined) throw new Error(`caso ${id} ausente`);
  return found;
};

type MockConfig = ConstructorParameters<typeof MastraLanguageModelV2Mock>[0];
const USAGE = { inputTokens: 1200, outputTokens: 40, totalTokens: 1240 };

// Resposta de uma chamada doGenerate (especificação V2 do AI SDK).
interface GenerateResponse {
  content: unknown[];
  finishReason: string;
  usage: typeof USAGE;
  warnings: unknown[];
}

const toolCall = (toolName: string, input: unknown): GenerateResponse => ({
  content: [{ type: "tool-call", toolCallId: `call-${toolName}`, toolName, input: JSON.stringify(input) }],
  finishReason: "tool-calls",
  usage: USAGE,
  warnings: [],
});

const finalJson = (value: unknown): GenerateResponse => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  finishReason: "stop",
  usage: USAGE,
  warnings: [],
});

function mockModel(responses: GenerateResponse[]) {
  return new MastraLanguageModelV2Mock({ doGenerate: responses as unknown as MockConfig["doGenerate"] });
}

function turn(caseId: string, model: MastraLanguageModelV2Mock) {
  return runTurn({ model, modelLabel: "dublê", provider: "mock", testCase: caseById(caseId), repetition: 1, allowedHosts: [] });
}

describe("run.ts de ponta a ponta com o dublê do Mastra", () => {
  it("C3: chama listMyTickets, devolve a interpretação estruturada e pontua correto", async () => {
    const model = mockModel([
      toolCall("listMyTickets", {}),
      finalJson({ intent: "LIST_MY_TICKETS", confidence: "HIGH", entities: {}, missingFields: [] }),
    ]);
    const record = await turn("C3", model);

    assert.equal(record.status, "completed", JSON.stringify(record.execError));
    assert.deepEqual(record.businessToolCalls, [{ tool: "listMyTickets", args: {}, rejected: false }]);
    assert.deepEqual(record.toolLog, [{ tool: "listMyTickets", args: {} }]);
    assert.equal(record.zodValid, true);
    assert.equal(record.calls.length, 2);
    assert.deepEqual(record.calls.map((c) => c.inputTokens), [1200, 1200]);
    assert.deepEqual(record.externalRequests, []);
    assert.equal(record.contextCheck.overBudget, false);

    // O modelo recebeu o prompt de sistema e as quatro tools de negócio.
    const firstCall = model.doGenerateCalls[0] as { prompt: { role: string }[]; tools?: { name: string }[] };
    assert.equal(firstCall.prompt[0]?.role, "system");
    assert.deepEqual(firstCall.tools?.map((t) => t.name).sort(), ["listMyTickets", "proposeTicketDraft", "requestHandoff", "searchArticles"]);

    const score = scoreTurn(record, caseById("C3"));
    assert.deepEqual([score.zodValid, score.intentCorrect, score.toolCorrect, score.entitiesCorrect, score.reasons], [true, true, true, true, []]);
  });

  it("C5: o histórico gravado (com a proposta aberta) chega ao modelo antes do turno avaliado", async () => {
    const model = mockModel([
      toolCall("requestHandoff", { reason: "Pediu um atendente humano." }),
      finalJson({ intent: "HANDOFF", confidence: "HIGH", entities: {}, missingFields: [] }),
    ]);
    const record = await turn("C5", model);
    assert.equal(record.status, "completed", JSON.stringify(record.execError));

    const prompt = JSON.stringify((model.doGenerateCalls[0] as { prompt: unknown }).prompt);
    assert.ok(prompt.includes("PA-SPIKE-1"), "o resultado da proposeTicketDraft gravada está no prompt");
    assert.ok(prompt.includes("Quero falar com um atendente humano"), "o turno avaliado está no prompt");
    assert.deepEqual(scoreTurn(record, caseById("C5")).reasons, []);
  });

  it("C6: sem tool, impacto e ação esperados", async () => {
    const model = mockModel([
      finalJson({ intent: "CREATE_TICKET", confidence: "MEDIUM", entities: { impact: { workImpact: "BLOCKED" } }, missingFields: ["AFFECTED_SCOPE"] }),
    ]);
    const record = await turn("C6", model);
    assert.deepEqual(record.businessToolCalls, []);
    assert.equal(scoreTurn(record, caseById("C6")).c6Expected, true);
  });

  it("chamada com argumento de identidade é recusada pela validação e não executa a tool falsa", async () => {
    const model = mockModel([
      toolCall("listMyTickets", { userId: "EMP-A" }),
      finalJson({ intent: "LIST_MY_TICKETS", confidence: "HIGH", entities: {}, missingFields: [] }),
    ]);
    const record = await turn("C3", model);
    assert.deepEqual(record.businessToolCalls, [{ tool: "listMyTickets", args: { userId: "EMP-A" }, rejected: true }]);
    assert.deepEqual(record.toolLog, []);
    assert.deepEqual(scoreTurn(record, caseById("C3")).reasons, ["SEM_WRONG_TOOL_ARGS"]);
  });

  it("interpretação fora do schema estrito: registrada crua e inválida pelo Zod", async () => {
    const model = mockModel([
      toolCall("listMyTickets", {}),
      finalJson({ intent: "LIST_MY_TICKETS", confidence: "HIGH", entities: {}, missingFields: [], extra: true }),
    ]);
    const record = await turn("C3", model);
    assert.equal(record.status, "completed", JSON.stringify(record.execError));
    assert.equal(record.zodValid, false);
    assert.deepEqual(record.interpretationRaw, { intent: "LIST_MY_TICKETS", confidence: "HIGH", entities: {}, missingFields: [], extra: true });
    assert.deepEqual(scoreTurn(record, caseById("C3")).reasons, ["SEM_INVALID_INTERPRETATION"]);
  });
});

// Erro de API no formato do AI SDK (statusCode, cabeçalhos, corpo).
const rateLimitError = (message: string, retryAfter: string) =>
  Object.assign(new Error(message), {
    name: "AI_APICallError",
    statusCode: 429,
    responseHeaders: {
      "retry-after": retryAfter,
      "x-ratelimit-limit-requests": "1000",
      "x-ratelimit-limit-tokens": "8000",
      "x-ratelimit-remaining-requests": "998",
      "x-ratelimit-remaining-tokens": "0",
      "x-ratelimit-reset-requests": "2m52.8s",
      "x-ratelimit-reset-tokens": "1.62s",
    },
    responseBody: message,
  });

describe("novas tentativas e cota com o dublê", () => {
  it("429 por minuto: respeita o Retry-After, registra o 429 sem x-ratelimit-* (JSONL e resumo) e conclui na segunda tentativa", async () => {
    let calls = 0;
    const answers = [toolCall("listMyTickets", {}), finalJson({ intent: "LIST_MY_TICKETS", confidence: "HIGH", entities: {}, missingFields: [] })];
    const model = new MastraLanguageModelV2Mock({
      doGenerate: (async () => {
        calls += 1;
        if (calls === 1) throw rateLimitError("Rate limit reached: tokens per minute (TPM)", "1");
        return answers[calls - 2];
      }) as unknown as MockConfig["doGenerate"],
    });
    const record = await turn("C3", model);
    assert.equal(record.status, "completed", JSON.stringify(record.execError));
    assert.equal(record.attempts, 2);
    assert.equal(record.rateLimits.length, 1);
    const event = record.rateLimits[0];
    assert.equal(event?.attempt, 1);
    assert.equal(event?.status, 429);
    assert.equal(event?.code, "EXEC_RATE_LIMIT");
    assert.equal(event?.daily, false);
    assert.equal(event?.retryAfterSeconds, 1);
    assert.equal(event?.waitSeconds, 1);
    assert.equal(record.previousAttempts[0]?.error.status, 429);
    assert.ok((record.totalInputTokens ?? 0) > 0, "tokens da tentativa pontuada preservados");

    // O que vai para disco: o .jsonl e o -summary.md, montados pelas mesmas funções da CLI.
    const header: RunHeader = {
      type: "run",
      model: "dublê",
      provider: "mock",
      startedAt: "2026-11-11T00:00:00.000Z",
      packages: {},
      manifest: [],
      settings: {},
      reasoningControl: "dublê de teste",
      allowedHosts: [],
      warmup: { latencyMs: null, error: null },
    };
    // O aggregate exige os 18 pares caso/repetição: o registro do 429 entra como C3/1 e os
    // demais pares são cópias dele com outro caso e repetição (só para montar o resumo).
    const all = cases.flatMap((c) => [1, 2, 3].map((repetition) => (c.id === "C3" && repetition === 1 ? record : { ...record, caseId: c.id, repetition })));
    const scores = all.map((r) => scoreTurn(r, caseById(r.caseId)));
    const jsonl = runJsonl(header, all);
    const summary = summaryMarkdown(header, all, scores, aggregate(cases, scores));
    for (const [name, text] of [["jsonl", jsonl], ["resumo", summary]] as const) {
      assert.doesNotMatch(text, /x-ratelimit/i, `${name} sem x-ratelimit-*`);
      assert.doesNotMatch(text, /2m52\.8s|"8000"|"998"/, `${name} sem valores dos x-ratelimit-*`);
    }
    assert.match(jsonl, /"retryAfterSeconds":1/);
    assert.match(summary, /tentativa 1: EXEC_RATE_LIMIT \(HTTP 429\); Retry-After 1 s; espera 1 s/);
  });

  it("cota diária esgotada: para a execução e as restantes ficam no denominador como EXEC_QUOTA", async () => {
    let calls = 0;
    const model = new MastraLanguageModelV2Mock({
      doGenerate: (async () => {
        calls += 1;
        // Aquecimento conclui; o primeiro turno avaliado esgota a cota diária.
        if (calls === 1) return finalJson({ intent: "CLARIFY", confidence: "LOW", entities: {}, missingFields: [] });
        throw rateLimitError("Rate limit reached: tokens per day (TPD)", "3600");
      }) as unknown as MockConfig["doGenerate"],
    });
    const { warmup, records } = await runModel({ model, modelLabel: "dublê", provider: "mock", allowedHosts: [], cases });
    assert.equal(warmup.error, null);
    assert.equal(records.length, 18);
    assert.equal(calls, 2, "nenhuma chamada depois da cota esgotada");
    assert.ok(records.every((r) => r.execError?.code === "EXEC_QUOTA"));
    assert.equal(records[0]?.rateLimits[0]?.daily, true);
    const agg = aggregate(cases, records.map((r) => scoreTurn(r, caseById(r.caseId))));
    assert.equal(agg.denominator, 18);
    assert.equal(agg.zodValid.count, 0);
    assert.equal(agg.approvedOnThresholds, false);
  });
});

describe("partes puras do run.ts", () => {
  it("toMessages: histórico do C5 vira tool-call, tool-result e texto, e termina no turno avaliado", () => {
    const messages = toMessages(caseById("C5")) as { role: string; content: unknown }[];
    const roles = messages.map((m) => m.role);
    assert.deepEqual(roles.slice(-4), ["assistant", "tool", "assistant", "user"]);
    assert.equal(messages.at(-1)?.content, caseById("C5").input);
  });

  it("raciocínio no texto e na interpretação é detectado e removido antes de gravar", () => {
    const text = redactReasoningText("<think>vou pensar</think>Resposta final.");
    assert.equal(text.leaked, true);
    assert.equal(text.text.includes("vou pensar"), false);
    const value = redactReasoningValue({ intent: "HANDOFF", reasoning: "passo a passo" });
    assert.equal(value.leaked, true);
    assert.deepEqual(value.value, { intent: "HANDOFF", reasoning: "[raciocínio removido]" });
    assert.equal(redactReasoningText("Sem raciocínio.").leaked, false);
  });

  it("classifyError: 429 por minuto, 429 diário, timeout, rede e framework", () => {
    const apiError = (statusCode: number, message: string, headers: Record<string, string> = {}) =>
      Object.assign(new Error(message), { statusCode, responseHeaders: { ...headers, authorization: "Bearer segredo" }, responseBody: message });
    const perMinute = classifyError(apiError(429, "Rate limit reached: tokens per minute (TPM)", { "retry-after": "7" }));
    assert.equal(perMinute.code, "EXEC_RATE_LIMIT");
    assert.equal(perMinute.retryAfterSeconds, 7);
    assert.equal("headers" in perMinute, false, "nenhum cabeçalho sai do classifyError");
    assert.equal(classifyError(apiError(429, "Rate limit reached: tokens per day (TPD)")).code, "EXEC_QUOTA");
    assert.equal(classifyError(Object.assign(new Error("tempo"), { name: "TimeoutError" })).code, "EXEC_TIMEOUT");
    assert.equal(classifyError(new TypeError("fetch failed", { cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }) })).code, "EXEC_PROVIDER_ERROR");
    assert.equal(classifyError(new Error("bug")).code, "EXEC_FRAMEWORK");
    assert.equal(classifyError(apiError(500, "chave gsk_abc123 inválida")).message.includes("gsk_abc123"), false);
  });

  it("ollamaEnvProblem: OLLAMA_BASE_URL definida e vazia aborta; ausente ou preenchida segue", () => {
    const saved = process.env["OLLAMA_BASE_URL"];
    try {
      process.env["OLLAMA_BASE_URL"] = "";
      assert.match(ollamaEnvProblem() ?? "", /definida e vazia/);
      process.env["OLLAMA_BASE_URL"] = "http://localhost:11434/v1";
      assert.equal(ollamaEnvProblem(), null);
      delete process.env["OLLAMA_BASE_URL"];
      assert.equal(ollamaEnvProblem(), null);
    } finally {
      if (saved === undefined) delete process.env["OLLAMA_BASE_URL"];
      else process.env["OLLAMA_BASE_URL"] = saved;
    }
  });
});

describe("nova tentativa depois de tool executada", () => {
  it("cada tentativa guarda as próprias chamadas; pontua a última; o resumo aponta a tool repetida", async () => {
    let calls = 0;
    const model = new MastraLanguageModelV2Mock({
      doGenerate: (async () => {
        calls += 1;
        if (calls === 1) return toolCall("listMyTickets", {});
        // A tool já executou na tentativa 1 quando o 429 chega.
        if (calls === 2) throw rateLimitError("Rate limit reached: requests per minute (RPM)", "1");
        if (calls === 3) return toolCall("listMyTickets", {});
        return finalJson({ intent: "LIST_MY_TICKETS", confidence: "HIGH", entities: {}, missingFields: [] });
      }) as unknown as MockConfig["doGenerate"],
    });
    const record = await turn("C3", model);

    assert.equal(record.status, "completed", JSON.stringify(record.execError));
    assert.equal(record.attempts, 2);
    // Tentativa 1: a chamada executada fica no registro dela, com o erro que interrompeu.
    assert.equal(record.previousAttempts.length, 1);
    assert.deepEqual(record.previousAttempts[0]?.toolLog, [{ tool: "listMyTickets", args: {} }]);
    assert.deepEqual(record.previousAttempts[0]?.businessToolCalls, [{ tool: "listMyTickets", args: {}, rejected: false }]);
    assert.deepEqual(record.previousAttempts[0]?.error.status, 429);
    // Última tentativa: uma chamada, não duas; é ela que a pontuação usa.
    assert.deepEqual(record.businessToolCalls, [{ tool: "listMyTickets", args: {}, rejected: false }]);
    assert.deepEqual(record.toolLog, [{ tool: "listMyTickets", args: {} }]);
    assert.deepEqual(scoreTurn(record, caseById("C3")).reasons, []);
    assert.deepEqual(retriedToolLines([record]), [
      "- C3, repetição 1: a tentativa 1 executou listMyTickets antes de EXEC_RATE_LIMIT (HTTP 429); pontuada a tentativa 2",
    ]);
  });
});

describe("console sem segredos", () => {
  it("chave fictícia sentinela não aparece no console; código, status e mensagem útil aparecem", async () => {
    const SENTINEL = "SENTINELA-chave-ficticia-9f3a7c";
    const previousKey = process.env["GROQ_API_KEY"];
    process.env["GROQ_API_KEY"] = SENTINEL;
    const failure = Object.assign(new Error(`Invalid API Key: ${SENTINEL}`), {
      name: "AI_APICallError",
      statusCode: 401,
      responseHeaders: { authorization: `Bearer ${SENTINEL}`, "x-request-id": "req-1" },
      requestBodyValues: { model: "openai/gpt-oss-120b", apiKey: SENTINEL },
      config: { apiKey: SENTINEL, headers: { Authorization: `Bearer ${SENTINEL}` } },
      responseBody: `{"error":{"message":"Invalid API Key","key":"${SENTINEL}"}}`,
    });
    const model = new MastraLanguageModelV2Mock({
      doGenerate: (async () => {
        throw failure;
      }) as unknown as MockConfig["doGenerate"],
    });

    // Captura tudo o que sairia no terminal durante o turno.
    const captured: string[] = [];
    const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;
    const originalConsole = methods.map((m) => console[m]);
    const originalOut = process.stdout.write.bind(process.stdout);
    const originalErr = process.stderr.write.bind(process.stderr);
    const collect = (...args: unknown[]) => {
      captured.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a, (_k, v: unknown) => (v instanceof Error ? { ...v, errorName: v.name, errorMessage: v.message } : v)))).join(" "));
    };
    methods.forEach((m) => {
      console[m] = collect;
    });
    process.stdout.write = ((chunk: unknown) => (collect(String(chunk)), true)) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown) => (collect(String(chunk)), true)) as typeof process.stderr.write;
    let record;
    try {
      record = await turn("C3", model);
    } finally {
      methods.forEach((m, i) => {
        console[m] = originalConsole[i] as (...args: unknown[]) => void;
      });
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
      if (previousKey === undefined) delete process.env["GROQ_API_KEY"];
      else process.env["GROQ_API_KEY"] = previousKey;
    }

    const output = captured.join("\n");
    assert.equal(output.includes(SENTINEL), false, `a sentinela vazou no console:\n${output}`);
    assert.match(output, /EXEC_PROVIDER_ERROR \(HTTP 401\)/);
    assert.match(output, /Invalid API Key/);
    assert.equal(JSON.stringify(record).includes(SENTINEL), false, "a sentinela também não vai para o registro");
    assert.equal(record?.execError?.code, "EXEC_PROVIDER_ERROR");
  });
});
