// Apoio aos testes da V3 (só testes): casos, respostas HTTP fabricadas no formato chat.completions
// pelo caminho real do Ollama (model router), e um registro fabricado que passa nas invariantes.
import { readFileSync } from "node:fs";

import { casesFileSchema } from "../../src/cases-schema.ts";
import { spikeModels } from "../../src/models.ts";
import { contextCheckOf } from "../../v2/src/run.ts";
import type { AttemptV3, Phase1Record, Phase2Record, TurnRecordV3 } from "./record.ts";
import type { TurnInputV3 } from "./run.ts";

export const cases = casesFileSchema.parse(JSON.parse(readFileSync(new URL("../../cases.json", import.meta.url), "utf8"))).cases;
export const caseById = (id: string) => {
  const found = cases.find((c) => c.id === id);
  if (found === undefined) throw new Error(`caso ${id} ausente`);
  return found;
};

export const VALID = {
  C3: { intent: "LIST_MY_TICKETS", confidence: "HIGH", entities: {}, missingFields: [] },
  C5: { intent: "HANDOFF", confidence: "HIGH", entities: {}, missingFields: [] },
  C6: { intent: "CREATE_TICKET", confidence: "MEDIUM", entities: { problem: "parou tudo", impact: { workImpact: "BLOCKED" } }, missingFields: ["AFFECTED_SCOPE"] },
} as const;

// Caminho real do Ollama pelo model router (src/models.ts).
const ollama = spikeModels().find((m) => m.label === "ollama qwen3:4b-instruct");
if (ollama === undefined) throw new Error("modelo do Ollama ausente em src/models.ts");
export const OLLAMA = ollama;
export const OLLAMA_HOST = new URL(String((ollama.config as { url: string }).url)).host;

export function turnInput(caseId: string, extra: Partial<TurnInputV3> = {}): TurnInputV3 {
  return { model: OLLAMA.config, modelLabel: OLLAMA.label, provider: "ollama", testCase: caseById(caseId), repetition: 1, allowedHosts: [OLLAMA_HOST], ...extra };
}

// ---------------------------------------------------------------------------
// Respostas HTTP fabricadas.

export type ToolCallSpec = [id: string, name: string, args: unknown];
const USAGE_HTTP = { prompt_tokens: 900, completion_tokens: 20, total_tokens: 920 };

export const completion = (calls: ToolCallSpec[], extra: { content?: string | null; usage?: unknown } = {}) => ({
  id: "chatcmpl-fabricado",
  object: "chat.completion",
  created: 1_700_000_000,
  model: "fabricado",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: extra.content ?? null,
        tool_calls: calls.map(([id, name, args]) => ({ id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } })),
      },
      finish_reason: "tool_calls",
    },
  ],
  usage: "usage" in extra ? extra.usage : USAGE_HTTP,
});

export const textCompletion = (text: string, extra: { finish?: string; reasoning?: string; usage?: unknown } = {}) => ({
  id: "chatcmpl-fabricado",
  object: "chat.completion",
  created: 1_700_000_000,
  model: "fabricado",
  choices: [{ index: 0, message: { role: "assistant", content: text, ...(extra.reasoning ? { reasoning_content: extra.reasoning } : {}) }, finish_reason: extra.finish ?? "stop" }],
  usage: "usage" in extra ? extra.usage : USAGE_HTTP,
});

export interface HttpReply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  delayMs?: number;
}
export const reply = (status: number, body: unknown, headers?: Record<string, string>): HttpReply => ({ status, body, headers });
export const error500 = reply(500, { error: { message: "falha fabricada" } });
export const error401 = reply(401, { error: { message: "Invalid API Key" } });
export const error429 = (retryAfter = "0", message = "Rate limit reached: tokens per minute (TPM)") => reply(429, { error: { message } }, { "retry-after": retryAfter });
export const delayed = (ms: number, body: unknown): HttpReply => ({ status: 200, body, delayMs: ms });

const isReply = (x: unknown): x is HttpReply => typeof x === "object" && x !== null && "status" in x && "body" in x;

export interface SeenRequest {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

// Substitui o fetch global ABAIXO do instrumento (o runAttempt instala o monitor da V2.1 e a camada
// da V3 por cima do fetch que encontrar). Responde pelo roteiro; depois do roteiro, texto marcado.
export async function withHttp<T>(script: unknown[], fn: () => Promise<T>) {
  const original = globalThis.fetch;
  const requests: SeenRequest[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push({ url, method: (init?.method ?? "GET").toUpperCase(), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    const step = script[requests.length - 1] ?? textCompletion("FORA DO ROTEIRO");
    const r: HttpReply = isReply(step) ? step : { status: 200, body: step };
    if (r.delayMs !== undefined) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, r.delayMs);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(init.signal?.reason ?? new Error("aborted"));
        });
      });
    }
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  }) as typeof fetch;
  try {
    return { result: await fn(), requests };
  } finally {
    globalThis.fetch = original;
  }
}

// ---------------------------------------------------------------------------
// Registro fabricado que passa em todas as invariantes (base dos testes de I1–I10).

export function okPhase1(): Phase1Record {
  return {
    status: "completed",
    execError: null,
    emitted: [{ step: 0, order: 0, toolCallId: "L1", toolName: "listMyTickets", rawArgs: {}, validAtCapture: true }],
    steps: [
      { index: 0, verdict: "OK", lateChunks: 0 },
      { index: 1, verdict: null, lateChunks: 0 },
    ],
    executions: [{ step: 0, toolCallId: "L1", toolName: "listMyTickets", outcome: "EXECUTED", args: {}, validAtCapture: true }],
    toolLog: [{ tool: "listMyTickets", args: {} }],
    calls: [
      { index: 0, inputTokens: 900, outputTokens: 20, latencyMs: 1, finishReason: "tool-calls" },
      { index: 1, inputTokens: 900, outputTokens: 20, latencyMs: 1, finishReason: "stop" },
    ],
    text: "",
    reasoning: { separatePresent: false, leakedInText: false, leakedInArgs: false },
    contextCheck: contextCheckOf(900, 1000, false),
    latencyMs: 2,
    modelRequests: 2,
    transcript: { messages: 2, assistantWithToolCalls: 1, toolMessages: 1 },
  };
}

export function okPhase2(): Phase2Record {
  return {
    stepsObservable: true,
    status: "completed",
    execError: null,
    calls: [{ index: 0, inputTokens: 900, outputTokens: 20, latencyMs: 1, finishReason: "stop" }],
    finishReason: "stop",
    text: JSON.stringify(VALID.C3),
    interpretationRaw: VALID.C3,
    parse: "OK",
    zodValid: true,
    zodIssues: [],
    mastraObject: VALID.C3,
    mastraObjectPresent: true,
    toolCalls: { count: 0, names: [] },
    validInterpretations: 1,
    request: { requests: 1, anyTools: false, anyToolChoice: false, allResponseFormat: true, anyReasoning: false },
    toolLogGrowth: 0,
    reasoning: { separatePresent: false, leakedInText: false, leakedInInterpretation: false, leakedInObject: false },
    contextCheck: contextCheckOf(900, 1000, false),
    latencyMs: 1,
  };
}

export function okRecord(patch: Partial<AttemptV3> = {}): TurnRecordV3 {
  return {
    type: "turn",
    experiment: "v3",
    model: "fabricado",
    provider: "mock",
    caseId: "C3",
    repetition: 1,
    startedAt: "",
    attempt: 1,
    attempts: 1,
    status: "completed",
    execError: null,
    phase1: okPhase1(),
    phase2: okPhase2(),
    phase2Invocations: 1,
    fidelity: { violations: [], diagnostics: [] },
    instrumentFailures: [],
    rateLimits: [],
    previousAttempts: [],
    contextCheck: contextCheckOf(900, 1000, false),
    turnLatencyMs: 3,
    externalRequests: [],
    ...patch,
  };
}
