// Execução do spike do ADR-009 (Fase 2a): 6 casos × 3 repetições por modelo, com o agent do
// Mastra, o prompt, as tools falsas e a interpretação estruturada congelados (CRITERIA.md).
//
// Uso (as variáveis vêm do ambiente; este script não lê o .env):
//   node --env-file=.env src/run.ts --model "ollama qwen3:4b-instruct"
//   node --env-file=.env src/run.ts --model "groq openai/gpt-oss-120b"
// Os rótulos válidos são os de src/models.ts.
//
// Saída: results/<modelo>/<instante>.jsonl (cabeçalho + 18 turnos, sem segredos) e
// results/<modelo>/<instante>-summary.md.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { Agent } from "@mastra/core/agent";
import type { MessageListInput } from "@mastra/core/agent/message-list";
import type { MastraModelConfig } from "@mastra/core/llm";
import { noopLogger } from "@mastra/core/logger";
import { z } from "zod";

import { casesFileSchema, type CasesFile } from "./cases-schema.ts";
import { spikeModels } from "./models.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import {
  BUSINESS_TOOLS,
  INPUT_TOKEN_BUDGET,
  OUTPUT_TOKEN_LIMIT,
  type BusinessTool,
  type BusinessToolCall,
  type ExecCode,
  type ModelCallRecord,
  type PreviousAttempt,
  type RateLimitEvent,
  type RunHeader,
  type TurnRecord,
} from "./run-record.ts";
import { interpretationSchema } from "./schema.ts";
import { aggregate, scoreTurn, type Aggregate, type TurnScore } from "./score.ts";
import { TOOL_INPUT_SCHEMAS, createFakeTools } from "./tools.ts";

type Case = CasesFile["cases"][number];
export type Provider = TurnRecord["provider"];

const ROOT = new URL("../", import.meta.url);

// CRITERIA.md, "Configuração": temperatura 0, seed 42, saída máxima 512. maxRetries 0: as
// novas tentativas são deste script, para registrar cada 429 e respeitar o Retry-After.
// Sondagens de 2026-11-11, nos três modelos: seed 42 transmitido no payload (não prova
// determinismo); limite de saída enviado como max_tokens e aplicado (finish_reason "length").
export const MODEL_SETTINGS = { temperature: 0, seed: 42, maxOutputTokens: OUTPUT_TOKEN_LIMIT, maxRetries: 0 } as const;
const MAX_STEPS = 5;
const TURN_TIMEOUT_MS = 180_000;
const MAX_ATTEMPTS = 3;

// Opções de provider (valores JSON), no formato do providerOptions do Mastra.
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type ProviderOptionsJson = Record<string, Record<string, JsonValue>>;

// Controle de raciocínio por provider: só o que as sondagens de 2026-11-11 (results/probes/)
// observaram. O prompt nunca é ajustado por modelo (CRITERIA.md).
// - Ollama: reasoning_effort "none" transmitido e aceito (HTTP 200) nos dois modelos; nenhum
//   raciocínio na resposta. qwen3:8b (/api/show: capacidade "thinking"): a chamada de controle,
//   igual mas sem o parâmetro, raciocinou (campo presente, 93 tokens de saída) e a com o parâmetro
//   não (5 tokens): efeito comprovado. qwen3:4b-instruct: o /api/show também declara "thinking",
//   mas o controle sem o parâmetro não raciocinou (9 tokens, como a chamada A): efeito não
//   comprovado; neste caminho o modelo não raciocina nem sem o parâmetro.
// - Groq gpt-oss-120b: reasoning_format "hidden" transmitido e aceito; campo de raciocínio
//   ausente, mas 46 reasoning_tokens informados: REASONING_HIDDEN, não desativação.
export const REASONING_CONTROL: Record<Provider, { providerOptions?: ProviderOptionsJson; note: string }> = {
  ollama: {
    providerOptions: { ollama: { reasoningEffort: "none" } },
    note: "reasoning_effort none (qwen3:8b: efeito comprovado por chamada de controle; qwen3:4b-instruct: efeito não comprovado, o controle sem o parâmetro também não raciocinou)",
  },
  groq: {
    providerOptions: { groq: { reasoningFormat: "hidden" } },
    note: "reasoning_format hidden (REASONING_HIDDEN: o raciocínio continua, só não é devolvido)",
  },
  mock: { note: "dublê de teste" },
};

// O src/models.ts (congelado) usa OLLAMA_BASE_URL ?? padrão: uma variável definida e VAZIA vira
// url "" e o Mastra procura um gateway "ollama", que não existe (falha antes de qualquer
// requisição; observado na sondagem de 2026-11-11). Aborta com mensagem clara.
export function ollamaEnvProblem(): string | null {
  return process.env["OLLAMA_BASE_URL"] === ""
    ? "OLLAMA_BASE_URL está definida e vazia no ambiente; o src/models.ts trata vazio como URL. Defina a URL (ex.: http://localhost:11434/v1) ou remova a variável."
    : null;
}

// ---------------------------------------------------------------------------
// Histórico gravado → mensagens do AI SDK 5 (aceitas pelo Mastra como MessageListInput).

export function toMessages(testCase: Case): MessageListInput {
  const messages: unknown[] = [];
  testCase.history.forEach((turn, t) => {
    if (turn.role === "user") {
      messages.push({ role: "user", content: turn.content });
      return;
    }
    const toolCalls = turn.toolCalls ?? [];
    if (toolCalls.length > 0) {
      const ids = toolCalls.map((_, i) => `hist-${t}-${i}`);
      messages.push({
        role: "assistant",
        content: toolCalls.map((call, i) => ({ type: "tool-call", toolCallId: ids[i], toolName: call.tool, input: call.args })),
      });
      messages.push({
        role: "tool",
        content: toolCalls.map((call, i) => ({
          type: "tool-result",
          toolCallId: ids[i],
          toolName: call.tool,
          output: { type: "json", value: call.result },
        })),
      });
    }
    messages.push({ role: "assistant", content: turn.content });
  });
  messages.push({ role: "user", content: testCase.input });
  return messages as MessageListInput;
}

// ---------------------------------------------------------------------------
// Truncamento de contexto (método documentado no README):
// 1. Definição do CRITERIA.md: tokens de entrada informados pelo provider acima de 7680 em
//    qualquer chamada → EXEC_CONTEXT_TRUNCATED.
// 2. Indício de corte silencioso: tokens informados abaixo de metade da estimativa local
//    (caracteres / 4 do prompt, dos schemas e das mensagens). Só registrado.
// 3. Provider sem tokens de entrada informados: "unverified".

function estimateInputTokens(messages: MessageListInput): number {
  const toolsJson = Object.values(TOOL_INPUT_SCHEMAS).map((schema) => JSON.stringify(z.toJSONSchema(schema)));
  const chars =
    SYSTEM_PROMPT.length +
    toolsJson.join("").length +
    JSON.stringify(z.toJSONSchema(interpretationSchema)).length +
    JSON.stringify(messages).length;
  return Math.ceil(chars / 4);
}

// ---------------------------------------------------------------------------
// Raciocínio: detectado e removido antes de gravar (nunca persistido).

const REASONING_BLOCK = /<think>[\s\S]*?(<\/think>|$)|<\|channel\|>analysis[\s\S]*?(<\|end\|>|$)|<reasoning>[\s\S]*?(<\/reasoning>|$)/gi;
const REASONING_KEY = /reason|think|thought/i;

export function redactReasoningText(text: string): { text: string; leaked: boolean } {
  const redacted = text.replace(REASONING_BLOCK, "[raciocínio removido]");
  return { text: redacted, leaked: redacted !== text };
}

export function redactReasoningValue(value: unknown): { value: unknown; leaked: boolean } {
  if (typeof value === "string") {
    const r = redactReasoningText(value);
    return { value: r.text, leaked: r.leaked };
  }
  if (Array.isArray(value)) {
    let leaked = false;
    const items = value.map((item) => {
      const r = redactReasoningValue(item);
      leaked ||= r.leaked;
      return r.value;
    });
    return { value: items, leaked };
  }
  if (typeof value === "object" && value !== null) {
    let leaked = false;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (REASONING_KEY.test(key)) {
        out[key] = "[raciocínio removido]";
        leaked = true;
        continue;
      }
      const r = redactReasoningValue(item);
      leaked ||= r.leaked;
      out[key] = r.value;
    }
    return { value: out, leaked };
  }
  return { value, leaked: false };
}

// ---------------------------------------------------------------------------
// Rede: requisições durante o turno para hosts fora do endpoint do modelo (efeito externo).

async function withRequestMonitor<T>(allowedHosts: readonly string[], fn: () => Promise<T>): Promise<{ result: T; external: string[] }> {
  const original = globalThis.fetch;
  const external: string[] = [];
  globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    try {
      const url = new URL(raw);
      if (!allowedHosts.includes(url.host)) external.push(`${url.protocol}//${url.host}${url.pathname}`);
    } catch {
      external.push(raw.slice(0, 200));
    }
    return original(input, init);
  };
  try {
    return { result: await fn(), external };
  } finally {
    globalThis.fetch = original;
  }
}

// ---------------------------------------------------------------------------
// Erros.

const SECRET = /(gsk_[A-Za-z0-9]+|Bearer\s+\S+|api[_-]?key["'=:\s]+\S+)/gi;
// Segredos conhecidos, pelo valor lido do ambiente (process.env; o script não abre o .env).
const SECRET_ENV_NAMES = ["GROQ_API_KEY"];

export function sanitize(message: string): string {
  let out = message;
  for (const name of SECRET_ENV_NAMES) {
    const value = process.env[name];
    if (value !== undefined && value.length >= 8) out = out.split(value).join("[redacted]");
  }
  return out.replace(SECRET, "[redacted]").slice(0, 300);
}

// Durante o turno, todo console.* passa por aqui: texto sanitizado, erro como "nome: mensagem
// (status)", e nenhum objeto (cabeçalhos, configuração e requisições ficam de fora).
function safeArg(arg: unknown): string {
  if (typeof arg === "string") return sanitize(arg);
  if (arg instanceof Error) {
    const status = (arg as { statusCode?: unknown }).statusCode;
    return sanitize(`${arg.name}: ${arg.message}${typeof status === "number" ? ` (status ${status})` : ""}`);
  }
  if (arg === null || arg === undefined || typeof arg === "number" || typeof arg === "boolean") return String(arg);
  return "[objeto omitido]";
}

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug", "trace"] as const;

export async function withSanitizedConsole<T>(fn: () => Promise<T>): Promise<T> {
  const originals = CONSOLE_METHODS.map((method) => console[method]);
  CONSOLE_METHODS.forEach((method, i) => {
    const original = originals[i] as (...args: unknown[]) => void;
    console[method] = (...args: unknown[]) => original.call(console, ...args.map(safeArg));
  });
  try {
    return await fn();
  } finally {
    CONSOLE_METHODS.forEach((method, i) => {
      console[method] = originals[i] as (...args: unknown[]) => void;
    });
  }
}

interface ErrorInfo {
  code: ExecCode;
  message: string;
  status: number | null;
  retryAfterSeconds: number | null;
  daily: boolean;
}

function errorChain(error: unknown): Record<string, unknown>[] {
  const chain: Record<string, unknown>[] = [];
  let current: unknown = error;
  for (let i = 0; i < 6 && typeof current === "object" && current !== null; i++) {
    chain.push(current as Record<string, unknown>);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

export function classifyError(error: unknown): ErrorInfo {
  const chain = errorChain(error);
  const message = sanitize(chain.map((e) => String(e["message"] ?? "")).filter(Boolean).join(" | ") || String(error));
  const withStatus = chain.find((e) => typeof e["statusCode"] === "number");
  const status = withStatus ? (withStatus["statusCode"] as number) : null;
  // Dos cabeçalhos, só o Retry-After, já em segundos; nenhum cabeçalho sai daqui.
  const rawHeaders = (withStatus?.["responseHeaders"] ?? {}) as Record<string, unknown>;
  const retryAfterKey = Object.keys(rawHeaders).find((key) => key.toLowerCase() === "retry-after");
  const retryAfterSeconds = retryAfterSecondsOf(retryAfterKey === undefined ? null : String(rawHeaders[retryAfterKey]));
  const body = String(withStatus?.["responseBody"] ?? "");
  const daily = status === 429 && /per day|\bTPD\b|\bRPD\b|daily/i.test(`${message} ${body}`);
  const isTimeout = chain.some((e) => e["name"] === "TimeoutError" || e["name"] === "AbortError");
  const isNetwork = chain.some((e) => /ECONNREFUSED|ENOTFOUND|ECONNRESET|fetch failed/i.test(String(e["code"] ?? e["message"] ?? "")));
  const code: ExecCode = isTimeout
    ? "EXEC_TIMEOUT"
    : status === 429
      ? daily
        ? "EXEC_QUOTA"
        : "EXEC_RATE_LIMIT"
      : status !== null || isNetwork
        ? "EXEC_PROVIDER_ERROR"
        : "EXEC_FRAMEWORK";
  return { code, message, status, retryAfterSeconds, daily };
}

// Retry-After normalizado em segundos (forma numérica ou data HTTP); null se ausente ou ilegível.
export function retryAfterSecondsOf(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, Math.round((date - Date.now()) / 1000));
}

// ---------------------------------------------------------------------------
// Leitura defensiva do resultado do Mastra (formas descritas em stream/types.d.ts).

type Loose = Record<string, unknown>;
const asLoose = (value: unknown): Loose => (typeof value === "object" && value !== null ? (value as Loose) : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const numberOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function isValidationErrorResult(value: unknown): boolean {
  const v = asLoose(value);
  return v["error"] === true && "validationErrors" in v;
}

function parseJsonText(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Um turno (uma tentativa).

export interface TurnInput {
  model: MastraModelConfig;
  modelLabel: string;
  provider: Provider;
  testCase: Case;
  repetition: number;
  allowedHosts: readonly string[];
  providerOptions?: ProviderOptionsJson;
}

interface AttemptOutcome {
  record: TurnRecord;
  error: ErrorInfo | null;
}

export async function runAttempt(input: TurnInput, attempt: number): Promise<AttemptOutcome> {
  const { testCase, provider } = input;
  const { tools, calls: toolLog } = createFakeTools();
  const agent = new Agent({ id: "spike-adr009", name: "spike-adr009", instructions: SYSTEM_PROMPT, model: input.model, tools });
  // O logger do Mastra imprime o objeto de erro inteiro; o diagnóstico sai sanitizado pelo runTurn.
  agent.__setLogger(noopLogger);
  const messages = toMessages(testCase);
  const estimatedInputTokens = estimateInputTokens(messages);
  const startedAt = new Date().toISOString();
  const stamps: number[] = [];
  // Passos capturados ao terminar: quando o turno falha no meio (ex.: 429 depois de uma tool),
  // o resultado do Mastra volta sem `steps`, e estes são a única fonte das chamadas já feitas.
  const finishedSteps: Loose[] = [];
  const start = performance.now();

  let result: Loose = {};
  let thrown: unknown;
  const monitored = await withRequestMonitor(input.allowedHosts, () => withSanitizedConsole(async () => {
    try {
      result = asLoose(
        await agent.generate(messages, {
          structuredOutput: { schema: interpretationSchema, errorStrategy: "warn" },
          modelSettings: { ...MODEL_SETTINGS },
          maxSteps: MAX_STEPS,
          abortSignal: AbortSignal.timeout(TURN_TIMEOUT_MS),
          onStepFinish: (step: unknown) => {
            stamps.push(performance.now());
            finishedSteps.push(asLoose(step));
          },
          providerOptions: input.providerOptions,
        }),
      );
    } catch (error) {
      thrown = error;
    }
  }));
  const turnLatencyMs = Math.round(performance.now() - start);

  // O erro de validação da saída estruturada é semântico (interpretação inválida), não de execução.
  const resultError = result["error"];
  const isStructuredValidation = asLoose(resultError)["id"] === "STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED";
  const failure = thrown ?? (resultError !== undefined && !isStructuredValidation ? resultError : undefined);
  const error = failure === undefined ? null : classifyError(failure);

  const resultSteps = asArray(result["steps"]).map(asLoose);
  const steps = resultSteps.length > 0 ? resultSteps : finishedSteps;
  const businessToolCalls: BusinessToolCall[] = [];
  const syntheticToolCalls: { name: string }[] = [];
  const otherToolCalls: { name: string; args: unknown }[] = [];
  const rejectedIds = new Set<string>();
  // Chunks do Mastra trazem os dados em `payload`; a forma do AI SDK os traz no próprio objeto.
  const payloadOf = (chunk: unknown): Loose => {
    const loose = asLoose(chunk);
    return "payload" in loose ? asLoose(loose["payload"]) : loose;
  };
  for (const step of steps) {
    for (const chunk of asArray(step["toolResults"])) {
      const payload = payloadOf(chunk);
      if (isValidationErrorResult(payload["result"] ?? payload["output"])) rejectedIds.add(String(payload["toolCallId"]));
    }
  }
  for (const step of steps) {
    for (const chunk of asArray(step["toolCalls"])) {
      const payload = payloadOf(chunk);
      const name = String(payload["toolName"] ?? "");
      const { __mastraMetadata: _meta, ...args } = asLoose(payload["args"] ?? payload["input"]);
      if ((BUSINESS_TOOLS as readonly string[]).includes(name)) {
        businessToolCalls.push({ tool: name as BusinessTool, args, rejected: rejectedIds.has(String(payload["toolCallId"])) });
      } else if (provider === "groq" && /^json(_\d+)?$/.test(name)) {
        syntheticToolCalls.push({ name });
      } else {
        otherToolCalls.push({ name, args });
      }
    }
  }
  // Reconciliação com o registro das tools falsas: toda execução real tem de constar como chamada
  // executada (nenhuma chamada parcial desaparece). Compara por tool + argumentos.
  const executedKeys = businessToolCalls.filter((c) => !c.rejected).map((c) => `${c.tool}|${JSON.stringify(c.args)}`);
  for (const entry of toolLog) {
    const key = `${entry.tool}|${JSON.stringify(entry.args)}`;
    const index = executedKeys.indexOf(key);
    if (index >= 0) executedKeys.splice(index, 1);
    else businessToolCalls.push({ tool: entry.tool, args: entry.args, rejected: false });
  }

  // Interpretação crua: o objeto validado; senão o valor que falhou na validação; senão o JSON do texto.
  const details = asLoose(asLoose(resultError)["details"]);
  const fromDetails = typeof details["value"] === "string" ? parseJsonText(details["value"]) : undefined;
  const text = typeof result["text"] === "string" ? result["text"] : "";
  const rawInterpretation = result["object"] ?? fromDetails ?? parseJsonText(text) ?? null;
  const redactedInterpretation = redactReasoningValue(rawInterpretation);
  const redactedText = redactReasoningText(text);
  const zod = interpretationSchema.safeParse(redactedInterpretation.value);

  const calls: ModelCallRecord[] = steps.map((step, index) => {
    const usage = asLoose(step["usage"]);
    const end = stamps[index] ?? performance.now();
    const previous = index === 0 ? start : (stamps[index - 1] ?? start);
    return {
      index,
      inputTokens: numberOrNull(usage["inputTokens"]),
      outputTokens: numberOrNull(usage["outputTokens"]),
      latencyMs: Math.round(end - previous),
      finishReason: typeof step["finishReason"] === "string" ? step["finishReason"] : null,
    };
  });
  const totalUsage = asLoose(result["totalUsage"]);
  const reported = calls.map((c) => c.inputTokens).filter((v): v is number => v !== null);
  const maxReportedInputTokens = reported.length > 0 ? Math.max(...reported) : null;

  const separatePresent =
    asArray(result["reasoning"]).length > 0 ||
    (typeof result["reasoningText"] === "string" && result["reasoningText"].length > 0) ||
    steps.some((step) => asArray(step["reasoning"]).length > 0);

  const record: TurnRecord = {
    type: "turn",
    model: input.modelLabel,
    provider,
    caseId: testCase.id,
    repetition: input.repetition,
    startedAt,
    status: error === null ? "completed" : "execution_error",
    execError: error === null ? null : { code: error.code, message: error.message },
    attempts: attempt,
    rateLimits: [],
    previousAttempts: [],
    businessToolCalls,
    syntheticToolCalls,
    otherToolCalls,
    toolLog: toolLog.map((entry) => ({ tool: entry.tool, args: entry.args })),
    interpretationRaw: redactedInterpretation.value,
    zodValid: zod.success,
    zodIssues: zod.success ? [] : zod.error.issues.map((issue) => `${issue.path.join(".") || "(raiz)"}: ${issue.message}`),
    finalText: redactedText.text,
    reasoning: { separatePresent, leakedInText: redactedText.leaked, leakedInInterpretation: redactedInterpretation.leaked },
    calls,
    totalInputTokens: numberOrNull(totalUsage["inputTokens"]),
    totalOutputTokens: numberOrNull(totalUsage["outputTokens"]),
    turnLatencyMs,
    finishReason: typeof result["finishReason"] === "string" ? result["finishReason"] : null,
    contextCheck: contextCheckOf(maxReportedInputTokens, estimatedInputTokens, calls.length === 0 || calls.some((c) => c.inputTokens === null)),
    externalRequests: monitored.external,
  };
  return { record, error };
}

// Estado da verificação de truncamento (run-record.ts, TruncationStatus).
function contextCheckOf(maxReportedInputTokens: number | null, estimatedInputTokens: number, unverified: boolean): TurnRecord["contextCheck"] {
  const overBudget = maxReportedInputTokens !== null && maxReportedInputTokens > INPUT_TOKEN_BUDGET;
  const suspectedSilentTruncation = maxReportedInputTokens !== null && maxReportedInputTokens < estimatedInputTokens * 0.5;
  return {
    status: overBudget ? "DETECTED" : unverified || suspectedSilentTruncation ? "UNKNOWN" : "NOT_DETECTED",
    budget: INPUT_TOKEN_BUDGET,
    maxReportedInputTokens,
    estimatedInputTokens,
    overBudget,
    suspectedSilentTruncation,
    unverified,
  };
}

// Diagnóstico de falha: código, status HTTP e mensagem, sanitizados; nunca objetos.
function diagnose(input: TurnInput, attempt: number, error: ErrorInfo): void {
  const status = error.status === null ? "" : ` (HTTP ${error.status})`;
  console.error(sanitize(`[spike] ${input.testCase.id}, repetição ${input.repetition}, tentativa ${attempt}: ${error.code}${status}: ${error.message}`));
}

export class QuotaExhausted extends Error {}

// Um turno com novas tentativas: até 3, respeitando o Retry-After; cota diária esgotada para tudo.
// Cada tentativa interrompida guarda o próprio registro de chamadas em previousAttempts; a
// pontuação usa só a última tentativa, então nenhuma chamada some nem conta duas vezes.
export async function runTurn(input: TurnInput): Promise<TurnRecord> {
  const rateLimits: RateLimitEvent[] = [];
  const previousAttempts: PreviousAttempt[] = [];
  const finish = (outcome: AttemptOutcome): TurnRecord => {
    outcome.record.rateLimits = rateLimits;
    outcome.record.previousAttempts = previousAttempts;
    return outcome.record;
  };
  let last: AttemptOutcome | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    last = await runAttempt(input, attempt);
    const err = last.error;
    if (err !== null) diagnose(input, attempt, err);
    if (err === null || err.status !== 429) break;
    const willRetry = !err.daily && attempt < MAX_ATTEMPTS;
    const waitSeconds = willRetry ? Math.max(1, err.retryAfterSeconds ?? 2 ** attempt) : null;
    rateLimits.push({
      attempt,
      at: new Date().toISOString(),
      status: err.status,
      code: err.code,
      daily: err.daily,
      retryAfterSeconds: err.retryAfterSeconds,
      waitSeconds,
    });
    if (err.daily) throw Object.assign(new QuotaExhausted("cota diária esgotada"), { record: finish(last) });
    if (waitSeconds !== null) {
      previousAttempts.push({
        attempt,
        error: { code: err.code, message: err.message, status: err.status },
        businessToolCalls: last.record.businessToolCalls,
        toolLog: last.record.toolLog,
        calls: last.record.calls,
      });
      await sleep(waitSeconds * 1000);
    }
  }
  if (last === undefined) throw new Error("nenhuma tentativa executada");
  return finish(last);
}

// Registro de um turno não executado (cota diária esgotada antes dele): fica no denominador.
function notExecuted(input: Omit<TurnInput, "model">): TurnRecord {
  return {
    type: "turn",
    model: input.modelLabel,
    provider: input.provider,
    caseId: input.testCase.id,
    repetition: input.repetition,
    startedAt: new Date().toISOString(),
    status: "execution_error",
    execError: { code: "EXEC_QUOTA", message: "não executado: cota diária esgotada antes deste turno" },
    attempts: 0,
    rateLimits: [],
    previousAttempts: [],
    businessToolCalls: [],
    syntheticToolCalls: [],
    otherToolCalls: [],
    toolLog: [],
    interpretationRaw: null,
    zodValid: false,
    zodIssues: [],
    finalText: "",
    reasoning: { separatePresent: false, leakedInText: false, leakedInInterpretation: false },
    calls: [],
    totalInputTokens: null,
    totalOutputTokens: null,
    turnLatencyMs: 0,
    finishReason: null,
    contextCheck: contextCheckOf(null, 0, true),
    externalRequests: [],
  };
}

// ---------------------------------------------------------------------------
// Execução de um modelo: aquecimento + 18 turnos.

export interface RunOptions {
  model: MastraModelConfig;
  modelLabel: string;
  provider: Provider;
  allowedHosts: readonly string[];
  cases: readonly Case[];
  providerOptions?: ProviderOptionsJson;
}

export async function runModel(options: RunOptions): Promise<{ warmup: RunHeader["warmup"]; records: TurnRecord[] }> {
  // Aquecimento: uma chamada fora da contagem (latência fria).
  const warmupCase: Case = { ...(options.cases[0] as Case), history: [], input: "Olá." };
  let warmup: RunHeader["warmup"];
  try {
    const outcome = await runAttempt({ ...options, testCase: warmupCase, repetition: 0 }, 1);
    warmup = { latencyMs: outcome.record.turnLatencyMs, error: outcome.error?.message ?? null };
  } catch (error) {
    warmup = { latencyMs: null, error: sanitize(String(error)) };
  }

  const records: TurnRecord[] = [];
  let quotaExhausted = false;
  for (const testCase of options.cases) {
    for (const repetition of [1, 2, 3]) {
      const turnInput = { ...options, testCase, repetition };
      if (quotaExhausted) {
        records.push(notExecuted(turnInput));
        continue;
      }
      try {
        records.push(await runTurn(turnInput));
      } catch (error) {
        if (!(error instanceof QuotaExhausted)) throw error;
        quotaExhausted = true;
        records.push((error as QuotaExhausted & { record: TurnRecord }).record);
      }
    }
  }
  return { warmup, records };
}

// ---------------------------------------------------------------------------
// Manifesto (CRITERIA.md, "Arquivos"): o run só executa sobre o experimento congelado.

export function verifyManifest(): { file: string; sha256: string; ok: boolean }[] {
  const criteria = readFileSync(new URL("CRITERIA.md", ROOT), "utf8");
  const rows = [...criteria.matchAll(/\| `([^`]+)` \| `([0-9a-f]{64})` \|/g)];
  return rows.map(([, file = "", expected = ""]) => {
    const actual = createHash("sha256").update(readFileSync(new URL(file, ROOT))).digest("hex");
    return { file, sha256: actual, ok: actual === expected };
  });
}

function packageVersions(): Record<string, string> {
  const versions: Record<string, string> = { node: process.version };
  for (const name of ["@mastra/core", "@ai-sdk/groq", "zod"]) {
    const pkg = JSON.parse(readFileSync(new URL(`node_modules/${name}/package.json`, ROOT), "utf8")) as { version: string };
    versions[name] = pkg.version;
  }
  return versions;
}

// ---------------------------------------------------------------------------
// Resumo em Markdown.

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? null);
}

const mark = (pass: boolean) => (pass ? "aprovado" : "**reprovado**");

// Turnos em que uma tentativa interrompida já tinha executado tools: elas rodaram de novo na
// tentativa seguinte. Só a última tentativa é pontuada.
export function retriedToolLines(records: readonly TurnRecord[]): string[] {
  const lines = records.flatMap((r) =>
    r.previousAttempts
      .filter((p) => p.toolLog.length > 0)
      .map(
        (p) =>
          `- ${r.caseId}, repetição ${r.repetition}: a tentativa ${p.attempt} executou ${p.toolLog.map((t) => t.tool).join(", ")} antes de ${p.error.code}${p.error.status === null ? "" : ` (HTTP ${p.error.status})`}; pontuada a tentativa ${r.attempts}`,
      ),
  );
  return lines.length > 0 ? lines : ["- Nenhuma."];
}

export function summaryMarkdown(header: RunHeader, records: TurnRecord[], scores: TurnScore[], agg: Aggregate): string {
  const completed = records.filter((r) => r.status === "completed");
  const tokens = completed.map((r) => (r.totalInputTokens ?? 0) + (r.totalOutputTokens ?? 0));
  const lines = [
    `# Spike ADR-009: ${header.model}`,
    "",
    `Execução iniciada em ${header.startedAt}. **Não é baseline** (CRITERIA.md).`,
    "",
    `- Manifesto: ${header.manifest.every((m) => m.ok) ? "OK" : "**DIVERGENTE**"} (${header.manifest.length} arquivos)`,
    `- Pacotes: ${Object.entries(header.packages).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    `- Parâmetros: ${JSON.stringify(header.settings)}`,
    `- Controle de raciocínio: ${header.reasoningControl}`,
    `- Hosts permitidos: ${header.allowedHosts.join(", ") || "(nenhum)"}`,
    `- Aquecimento (latência fria): ${header.warmup.latencyMs ?? "—"} ms${header.warmup.error ? ` (erro: ${header.warmup.error})` : ""}`,
    `- Latência aquecida, mediana por turno: ${median(completed.map((r) => r.turnLatencyMs)) ?? "—"} ms`,
    `- Tokens por turno, mediana (entrada + saída): ${median(tokens) ?? "—"}`,
    `- Respostas 429: ${records.reduce((n, r) => n + r.rateLimits.length, 0)}`,
    "",
    "## Limites (denominador fixo de 18)",
    "",
    "| Limite | Resultado | Exigido | Situação |",
    "| --- | --- | --- | --- |",
    `| Interpretação válida (Zod) | ${agg.zodValid.count} | ≥ 17 | ${mark(agg.zodValid.pass)} |`,
    `| Intenção correta | ${agg.intent.count}; maioria em ${agg.intent.majorityCases} | ≥ 15; ≥ 5 | ${mark(agg.intent.pass)} |`,
    `| Tool correta | ${agg.tool.count}; maioria em ${agg.tool.majorityCases} | ≥ 15; ≥ 5 | ${mark(agg.tool.pass)} |`,
    `| Entidades e missingFields | ${agg.entities.count} | ≥ 15 | ${mark(agg.entities.pass)} |`,
    `| Estabilidade | ${agg.stability.allSameCases} entradas com 3 iguais; mínimo nas demais: ${agg.stability.othersMinConcordance ?? "—"} | ≥ 4; ≥ 2 | ${mark(agg.stability.pass)} |`,
    `| "Parou tudo!" (C6) | ${agg.c6.count} de 3 | 3 | ${mark(agg.c6.pass)} |`,
    `| Tolerância zero | vazamentos ${agg.zeroTolerance.reasoningLeaks}; efeitos externos ${agg.zeroTolerance.externalEffects}; truncamento: ${agg.zeroTolerance.truncation.status} (NOT_DETECTED ${agg.zeroTolerance.truncation.notDetected}, DETECTED ${agg.zeroTolerance.truncation.detected}, UNKNOWN ${agg.zeroTolerance.truncation.unknown}) | 0; truncamento NOT_DETECTED nos 18 | ${mark(agg.zeroTolerance.pass)} |`,
    "",
    `**Nos limites: ${agg.approvedOnThresholds ? "aprovado" : "reprovado"}.** E1 a E4 são verificados fora do score.`,
    "",
    "## Turnos",
    "",
    "| Caso | Rep. | Zod | Intenção | Tool | Entidades | Motivos | Latência (ms) | Tokens entrada/saída |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...scores.map((s, i) => {
      const r = records[i] as TurnRecord;
      const yn = (b: boolean) => (b ? "sim" : "não");
      return `| ${s.caseId} | ${s.repetition} | ${yn(s.zodValid)} | ${yn(s.intentCorrect)} | ${yn(s.toolCorrect)} | ${yn(s.entitiesCorrect)} | ${s.reasons.join(", ") || "—"} | ${r.turnLatencyMs} | ${r.totalInputTokens ?? "—"}/${r.totalOutputTokens ?? "—"} |`;
    }),
    "",
    "## Contexto",
    "",
    `- Truncamento: ${agg.zeroTolerance.truncation.status} (NOT_DETECTED ${agg.zeroTolerance.truncation.notDetected}, DETECTED ${agg.zeroTolerance.truncation.detected}, UNKNOWN ${agg.zeroTolerance.truncation.unknown}); o requisito só aprova com os 18 em NOT_DETECTED`,
    `- Turnos com tokens de entrada não informados: ${records.filter((r) => r.contextCheck.unverified).length}`,
    `- Turnos com indício de corte silencioso: ${records.filter((r) => r.contextCheck.suspectedSilentTruncation).length}`,
    `- Maior entrada informada: ${Math.max(0, ...records.map((r) => r.contextCheck.maxReportedInputTokens ?? 0))} tokens (orçamento ${INPUT_TOKEN_BUDGET})`,
    `- Raciocínio em campo separado (descartado): ${records.filter((r) => r.reasoning.separatePresent).length} turnos`,
    "",
    "## Respostas 429",
    "",
    ...rateLimitLines(records),
    "",
    "## Tools repetidas por nova tentativa",
    "",
    ...retriedToolLines(records),
    "",
  ];
  return lines.join("\n");
}

// Cada 429: tentativa, status, classificação, Retry-After e espera, em segundos. Sem cabeçalhos.
function rateLimitLines(records: readonly TurnRecord[]): string[] {
  const lines = records.flatMap((r) =>
    r.rateLimits.map(
      (e) =>
        `- ${r.caseId}, repetição ${r.repetition}, tentativa ${e.attempt}: ${e.code}${e.status === null ? "" : ` (HTTP ${e.status})`}${e.daily ? ", cota diária" : ""}; Retry-After ${e.retryAfterSeconds ?? "—"} s; espera ${e.waitSeconds ?? "—"} s`,
    ),
  );
  return lines.length > 0 ? lines : ["- Nenhuma."];
}

// Conteúdo do .jsonl de uma execução: cabeçalho e uma linha por turno.
export function runJsonl(header: RunHeader, records: readonly TurnRecord[]): string {
  return [header, ...records].map((line) => JSON.stringify(line)).join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// CLI.

function providerOf(label: string): Provider {
  if (label.startsWith("ollama ")) return "ollama";
  if (label.startsWith("groq ")) return "groq";
  throw new Error(`provider desconhecido para ${label}`);
}

function allowedHostsOf(provider: Provider, config: MastraModelConfig): string[] {
  if (provider === "groq") return ["api.groq.com"];
  const url = asLoose(config)["url"];
  return typeof url === "string" ? [new URL(url).host] : [];
}

async function main(): Promise<void> {
  const index = process.argv.indexOf("--model");
  const label = index >= 0 ? process.argv[index + 1] : undefined;
  const models = spikeModels();
  const chosen = models.find((m) => m.label === label);
  if (chosen === undefined) {
    console.error(`Uso: node --env-file=.env src/run.ts --model "<rótulo>"\nRótulos: ${models.map((m) => `"${m.label}"`).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const manifest = verifyManifest();
  if (manifest.length === 0 || manifest.some((m) => !m.ok)) {
    console.error(`Manifesto divergente: ${manifest.filter((m) => !m.ok).map((m) => m.file).join(", ") || "tabela não encontrada"}. Execução abortada.`);
    process.exitCode = 1;
    return;
  }

  const cases = casesFileSchema.parse(JSON.parse(readFileSync(new URL("cases.json", ROOT), "utf8"))).cases;
  const provider = providerOf(chosen.label);
  const envProblem = provider === "ollama" ? ollamaEnvProblem() : null;
  if (envProblem !== null) {
    console.error(`${envProblem} Execução abortada.`);
    process.exitCode = 1;
    return;
  }
  const allowedHosts = allowedHostsOf(provider, chosen.config);
  const startedAt = new Date().toISOString();

  const reasoning = REASONING_CONTROL[provider];
  const { warmup, records } = await runModel({
    model: chosen.config,
    modelLabel: chosen.label,
    provider,
    allowedHosts,
    cases,
    providerOptions: reasoning.providerOptions,
  });
  const scores = records.map((record) => scoreTurn(record, cases.find((c) => c.id === record.caseId) as Case));
  const agg = aggregate(cases, scores);

  const header: RunHeader = {
    type: "run",
    model: chosen.label,
    provider,
    startedAt,
    packages: packageVersions(),
    manifest,
    settings: { ...MODEL_SETTINGS, maxSteps: MAX_STEPS, turnTimeoutMs: TURN_TIMEOUT_MS, maxAttempts: MAX_ATTEMPTS, inputTokenBudget: INPUT_TOKEN_BUDGET },
    reasoningControl: `${reasoning.note}${reasoning.providerOptions ? `; providerOptions ${JSON.stringify(reasoning.providerOptions)}` : ""}`,
    allowedHosts,
    warmup,
  };

  const slug = chosen.label.replace(/[^a-zA-Z0-9.]+/g, "-");
  const stamp = startedAt.replace(/[:.]/g, "-");
  const dir = new URL(`results/${slug}/`, ROOT);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL(`${stamp}.jsonl`, dir), runJsonl(header, records));
  writeFileSync(new URL(`${stamp}-summary.md`, dir), summaryMarkdown(header, records, scores, agg));
  console.log(`Resultados em results/${slug}/${stamp}.jsonl e -summary.md. Nos limites: ${agg.approvedOnThresholds ? "aprovado" : "reprovado"}.`);
}

if (import.meta.main) {
  await main();
}
