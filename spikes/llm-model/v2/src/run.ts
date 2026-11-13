// Execução da V2 do spike do ADR-009 (v2/CRITERIA.md). Uso, depois do congelamento:
//   node --env-file=.env v2/src/run.ts --model "<rótulo>"
// Enquanto o manifesto da V2 não existir, a CLI se recusa a executar.
//
// Igual à V1 em configuração (MODEL_SETTINGS, REASONING_CONTROL, aquecimento, novas tentativas,
// maxSteps, tempo limite). Diferenças: sem structuredOutput; toolChoice "auto"; tools de negócio
// da V1 + submitInterpretation; guarda de passo, stopWhen e registro do protocolo (protocol.ts);
// invariantes conferidas em cada registro, inclusive no aquecimento, com aborto imediato.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { Agent } from "@mastra/core/agent";
import type { MessageListInput } from "@mastra/core/agent/message-list";
import type { MastraModelConfig } from "@mastra/core/llm";
import { noopLogger } from "@mastra/core/logger";
import { z } from "zod";

import { casesFileSchema, type CasesFile } from "../../src/cases-schema.ts";
import { spikeModels } from "../../src/models.ts";
import { INPUT_TOKEN_BUDGET, type ContextCheck, type ExecCode, type ModelCallRecord, type RateLimitEvent } from "../../src/run-record.ts";
import {
  MODEL_SETTINGS,
  QuotaExhausted,
  REASONING_CONTROL,
  classifyError,
  ollamaEnvProblem,
  redactReasoningText,
  sanitize,
  toMessages,
  withSanitizedConsole,
  type ProviderOptionsJson,
} from "../../src/run.ts";
import { interpretationSchema } from "../../src/schema.ts";
import { TOOL_INPUT_SCHEMAS, createFakeTools } from "../../src/tools.ts";
import { redactToolArgs } from "./leak.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import { TurnProtocol } from "./protocol.ts";
import type { InvariantViolation, PreviousAttemptV2, RunHeaderV2, TurnRecordV2 } from "./record.ts";
import { aggregateV2, checkInvariants, invariantReport, reconcile, scoreTurnV2, type AggregateV2, type TurnScoreV2 } from "./score.ts";

type Case = CasesFile["cases"][number];
export type Provider = TurnRecordV2["provider"];

// Raiz do spike (spikes/llm-model/): os caminhos do manifesto são relativos a ela.
const SPIKE_ROOT = new URL("../../", import.meta.url);
const V2_ROOT = new URL("../", import.meta.url);

// Iguais aos da V1 (não exportados por ela; o identity.test.ts confere no código da V1).
export const MAX_STEPS = 5;
export const TURN_TIMEOUT_MS = 180_000;
export const MAX_ATTEMPTS = 3;

type Loose = Record<string, unknown>;
const asLoose = (value: unknown): Loose => (typeof value === "object" && value !== null ? (value as Loose) : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const numberOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

// ---------------------------------------------------------------------------
// Reescritas com o mesmo comportamento da V1 (v2/CRITERIA.md, "Reutilização da V1").

// Estimativa local de tokens de entrada (V1: caracteres / 4 do prompt, dos schemas e das mensagens).
// Na V2, o prompt é o da V2; o schema da interpretação entra como entrada da submitInterpretation.
export function estimateInputTokens(messages: MessageListInput): number {
  const toolsJson = Object.values(TOOL_INPUT_SCHEMAS).map((schema) => JSON.stringify(z.toJSONSchema(schema)));
  const chars = SYSTEM_PROMPT.length + toolsJson.join("").length + JSON.stringify(z.toJSONSchema(interpretationSchema)).length + JSON.stringify(messages).length;
  return Math.ceil(chars / 4);
}

// V2.1 (v2/CRITERIA.md, "V2.1"): só passos COM inferência contam na verificação de truncamento.
// Passos "retry" (nova tentativa interna do Mastra depois de erro do provider) e "error" não são
// inferência: ficam fora da completude (unverified) E do maior inputTokens reportado. Nenhum valor é
// imputado nem copiado de outro passo. Na V2 (e0469db), todo passo contava, e um único retry sem
// usage deixava o turno UNKNOWN (mastra-behavior.test.ts).
export const NON_INFERENCE_FINISH_REASONS: readonly string[] = ["retry", "error"];

export function contextCheckFromCalls(calls: readonly ModelCallRecord[], estimatedInputTokens: number): ContextCheck {
  const inference = calls.filter((c) => !NON_INFERENCE_FINISH_REASONS.includes(c.finishReason ?? ""));
  const reported = inference.map((c) => c.inputTokens).filter((v): v is number => v !== null);
  const maxReportedInputTokens = reported.length > 0 ? Math.max(...reported) : null;
  // Sem passo de inferência, ou algum passo de inferência sem inputTokens: não verificado (UNKNOWN).
  const unverified = inference.length === 0 || inference.some((c) => c.inputTokens === null);
  return contextCheckOf(maxReportedInputTokens, estimatedInputTokens, unverified);
}

// Estado da verificação de truncamento (V1, contextCheckOf). Regras de DETECTED, orçamento e suspeita
// de corte silencioso inalteradas na V2.1.
export function contextCheckOf(maxReportedInputTokens: number | null, estimatedInputTokens: number, unverified: boolean): ContextCheck {
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

// Requisições durante o turno para hosts fora do endpoint do modelo (V1, withRequestMonitor).
export async function withRequestMonitor<T>(allowedHosts: readonly string[], fn: () => Promise<T>): Promise<{ result: T; external: string[] }> {
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

export function providerOf(label: string): Exclude<Provider, "mock"> {
  if (label.startsWith("ollama ")) return "ollama";
  if (label.startsWith("groq ")) return "groq";
  throw new Error(`provider desconhecido para ${label}`);
}

export function allowedHostsOf(provider: Provider, config: MastraModelConfig): string[] {
  if (provider === "groq") return ["api.groq.com"];
  const url = asLoose(config)["url"];
  return typeof url === "string" ? [new URL(url).host] : [];
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

type ErrorInfo = ReturnType<typeof classifyError>;

interface AttemptOutcome {
  record: TurnRecordV2;
  error: ErrorInfo | null;
}

export async function runAttempt(input: TurnInput, attempt: number): Promise<AttemptOutcome> {
  const { testCase, provider } = input;
  const protocol = new TurnProtocol();
  const { tools, calls: toolLog } = createFakeTools();
  const agent = new Agent({
    id: "spike-adr009-v2",
    name: "spike-adr009-v2",
    instructions: SYSTEM_PROMPT,
    model: input.model,
    tools: { ...tools, submitInterpretation: protocol.submitTool },
  });
  agent.__setLogger(noopLogger);
  const messages = toMessages(testCase);
  const estimatedInputTokens = estimateInputTokens(messages);
  const startedAt = new Date().toISOString();
  const stamps: number[] = [];
  const finishedSteps: Loose[] = [];
  const start = performance.now();

  let result: Loose = {};
  let thrown: unknown;
  const monitored = await withRequestMonitor(input.allowedHosts, () =>
    withSanitizedConsole(async () => {
      try {
        result = asLoose(
          await agent.generate(messages, {
            modelSettings: { ...MODEL_SETTINGS },
            maxSteps: MAX_STEPS,
            toolChoice: "auto",
            abortSignal: AbortSignal.timeout(TURN_TIMEOUT_MS),
            providerOptions: input.providerOptions,
            stopWhen: protocol.stopWhen,
            hooks: protocol.hooks,
            onChunk: protocol.onChunk,
            onStepFinish: (step: unknown) => {
              stamps.push(performance.now());
              finishedSteps.push(asLoose(step));
              protocol.onStepFinish();
            },
          } as never),
        );
      } catch (error) {
        thrown = error;
      }
    }),
  );
  const turnLatencyMs = Math.round(performance.now() - start);

  const resultError = result["error"];
  const failure = thrown ?? resultError;
  const error = failure === undefined ? null : classifyError(failure);

  const resultSteps = asArray(result["steps"]).map(asLoose);
  const steps = resultSteps.length > 0 ? resultSteps : finishedSteps;
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

  // Texto de todos os passos: não avaliado; só a checagem de vazamento.
  const text = steps.map((step) => (typeof step["text"] === "string" ? step["text"] : "")).filter(Boolean).join("\n");
  const redactedText = redactReasoningText(text);
  const separatePresent =
    asArray(result["reasoning"]).length > 0 ||
    (typeof result["reasoningText"] === "string" && result["reasoningText"].length > 0) ||
    steps.some((step) => asArray(step["reasoning"]).length > 0);

  const record: TurnRecordV2 = {
    type: "turn",
    experiment: "v2",
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
    emitted: protocol.emitted,
    steps: protocol.steps(),
    executions: protocol.executions,
    acceptedSubmissions: protocol.acceptedSubmissions,
    terminal: protocol.terminal,
    // Argumentos do registro das tools falsas (forma coagida), com raciocínio removido pela mesma política (leak.ts).
    toolLog: toolLog.map((entry) => ({ tool: entry.tool, args: redactToolArgs(entry.tool, entry.args).value })),
    finalText: redactedText.text,
    reasoning: { separatePresent, leakedInText: redactedText.leaked, leakedInArgs: protocol.leakedInArgs },
    calls,
    totalInputTokens: numberOrNull(totalUsage["inputTokens"]),
    totalOutputTokens: numberOrNull(totalUsage["outputTokens"]),
    turnLatencyMs,
    finishReason: typeof result["finishReason"] === "string" ? result["finishReason"] : null,
    contextCheck: contextCheckFromCalls(calls, estimatedInputTokens),
    externalRequests: monitored.external,
  };
  return { record, error };
}

function diagnose(input: TurnInput, attempt: number, error: ErrorInfo): void {
  const status = error.status === null ? "" : ` (HTTP ${error.status})`;
  console.error(sanitize(`[spike v2] ${input.testCase.id}, repetição ${input.repetition}, tentativa ${attempt}: ${error.code}${status}: ${error.message}`));
}

// Violação de invariante (defeito do instrumento) detectada numa tentativa: aborta a rodada.
// Distinto de QuotaExhausted (que é condição do provider e mantém a rodada no denominador).
export class InstrumentDefect extends Error {
  readonly record: TurnRecordV2;
  readonly violations: InvariantViolation[];
  constructor(record: TurnRecordV2, violations: InvariantViolation[]) {
    super(`defeito do instrumento: ${violations.map((v) => v.invariant).join(", ")}`);
    this.record = record;
    this.violations = violations;
  }
}

// Novas tentativas como na V1: até 3, respeitando o Retry-After; cota diária esgotada para tudo.
// As invariantes são conferidas logo após CADA tentativa, antes de qualquer espera ou nova
// tentativa: uma violação lança InstrumentDefect com o registro (e as tentativas anteriores).
export async function runTurn(input: TurnInput, invariantCheck: (record: TurnRecordV2) => InvariantViolation[] = checkInvariants): Promise<TurnRecordV2> {
  const rateLimits: RateLimitEvent[] = [];
  const previousAttempts: PreviousAttemptV2[] = [];
  const finish = (outcome: AttemptOutcome): TurnRecordV2 => {
    outcome.record.rateLimits = rateLimits;
    outcome.record.previousAttempts = previousAttempts;
    return outcome.record;
  };
  let last: AttemptOutcome | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    last = await runAttempt(input, attempt);
    const violations = invariantCheck(finish(last));
    if (violations.length > 0) throw new InstrumentDefect(finish(last), violations);
    const err = last.error;
    if (err !== null) diagnose(input, attempt, err);
    if (err === null || err.status !== 429) break;
    const willRetry = !err.daily && attempt < MAX_ATTEMPTS;
    const waitSeconds = willRetry ? Math.max(1, err.retryAfterSeconds ?? 2 ** attempt) : null;
    rateLimits.push({ attempt, at: new Date().toISOString(), status: err.status, code: err.code, daily: err.daily, retryAfterSeconds: err.retryAfterSeconds, waitSeconds });
    if (err.daily) throw Object.assign(new QuotaExhausted("cota diária esgotada"), { record: finish(last) });
    if (waitSeconds !== null) {
      previousAttempts.push({
        attempt,
        error: { code: err.code, message: err.message, status: err.status },
        emitted: last.record.emitted,
        steps: last.record.steps,
        executions: last.record.executions,
        acceptedSubmissions: last.record.acceptedSubmissions,
        terminal: last.record.terminal,
        toolLog: last.record.toolLog,
        calls: last.record.calls,
      });
      await sleep(waitSeconds * 1000);
    }
  }
  if (last === undefined) throw new Error("nenhuma tentativa executada");
  return finish(last);
}

function notExecuted(input: Omit<TurnInput, "model">): TurnRecordV2 {
  return {
    type: "turn",
    experiment: "v2",
    model: input.modelLabel,
    provider: input.provider,
    caseId: input.testCase.id,
    repetition: input.repetition,
    startedAt: new Date().toISOString(),
    status: "execution_error",
    execError: { code: "EXEC_QUOTA" as ExecCode, message: "não executado: cota diária esgotada antes deste turno" },
    attempts: 0,
    rateLimits: [],
    previousAttempts: [],
    emitted: [],
    steps: [],
    executions: [],
    acceptedSubmissions: [],
    terminal: null,
    toolLog: [],
    finalText: "",
    reasoning: { separatePresent: false, leakedInText: false, leakedInArgs: false },
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
// Uma rodada: aquecimento + 18 turnos, com as invariantes conferidas em cada registro.

export interface RunOptions {
  model: MastraModelConfig;
  modelLabel: string;
  provider: Provider;
  allowedHosts: readonly string[];
  cases: readonly Case[];
  providerOptions?: ProviderOptionsJson;
  // Só para testes: substitui o verificador de invariantes (o padrão é o checkInvariants).
  invariantCheck?: (record: TurnRecordV2) => InvariantViolation[];
}

export interface RoundResult {
  warmup: RunHeaderV2["warmup"];
  records: TurnRecordV2[];
  // Violação de invariante (defeito do instrumento): rodada abortada na hora, sem veredito.
  aborted: RunHeaderV2["aborted"];
}

export async function runModel(options: RunOptions): Promise<RoundResult> {
  const check = options.invariantCheck ?? checkInvariants;
  const warmupCase: Case = { ...(options.cases[0] as Case), history: [], input: "Olá." };
  let warmup: RunHeaderV2["warmup"];
  try {
    const outcome = await runAttempt({ ...options, testCase: warmupCase, repetition: 0 }, 1);
    const invariantViolations = check(outcome.record);
    warmup = { latencyMs: outcome.record.turnLatencyMs, error: outcome.error?.message ?? null, invariantViolations };
    if (invariantViolations.length > 0) return { warmup, records: [], aborted: { at: "aquecimento", violations: invariantViolations } };
  } catch (error) {
    warmup = { latencyMs: null, error: sanitize(String(error)), invariantViolations: [] };
  }

  const records: TurnRecordV2[] = [];
  let quotaExhausted = false;
  for (const testCase of options.cases) {
    for (const repetition of [1, 2, 3]) {
      const turnInput = { ...options, testCase, repetition };
      const at = `${testCase.id}, repetição ${repetition}`;
      if (quotaExhausted) {
        // Turno não executado: não passa pelo runTurn; as invariantes são conferidas aqui.
        const record = notExecuted(turnInput);
        records.push(record);
        const violations = check(record);
        if (violations.length > 0) return { warmup, records, aborted: { at, violations } };
        continue;
      }
      try {
        // O runTurn confere as invariantes depois de cada tentativa (inclusive a que esgota a cota).
        records.push(await runTurn(turnInput, check));
      } catch (error) {
        if (error instanceof InstrumentDefect) {
          records.push(error.record);
          return { warmup, records, aborted: { at, violations: error.violations } };
        }
        if (!(error instanceof QuotaExhausted)) throw error;
        quotaExhausted = true;
        records.push((error as QuotaExhausted & { record: TurnRecordV2 }).record);
      }
    }
  }
  return { warmup, records, aborted: null };
}

// ---------------------------------------------------------------------------
// Manifesto da V2 (v2/CRITERIA.md, "Arquivos"); caminhos relativos a spikes/llm-model/.

export function verifyManifest(criteriaText = readFileSync(new URL("CRITERIA.md", V2_ROOT), "utf8")): { file: string; sha256: string; ok: boolean }[] {
  const rows = [...criteriaText.matchAll(/\| `([^`]+)` \| `([0-9a-f]{64})` \|/g)];
  return rows.map(([, file = "", expected = ""]) => {
    const actual = createHash("sha256").update(readFileSync(new URL(file, SPIKE_ROOT))).digest("hex");
    return { file, sha256: actual, ok: actual === expected };
  });
}

// Digest da imagem Ollama (v2/CRITERIA.md, "Modelos"): lido de /api/tags do mesmo servidor, antes
// da rodada e fora do monitor de requisições do turno. null se o modelo não aparecer na lista.
export async function ollamaDigest(baseUrl: string, model: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const root = baseUrl.replace(/\/v1\/?$/, "");
  const response = await fetchImpl(`${root}/api/tags`);
  if (!response.ok) return null;
  const json = asLoose(await response.json());
  const entry = asArray(json["models"]).map(asLoose).find((m) => m["name"] === model || m["model"] === model);
  return typeof entry?.["digest"] === "string" ? entry["digest"] : null;
}

function packageVersions(): Record<string, string> {
  const versions: Record<string, string> = { node: process.version };
  for (const name of ["@mastra/core", "@ai-sdk/groq", "zod"]) {
    const pkg = JSON.parse(readFileSync(new URL(`node_modules/${name}/package.json`, SPIKE_ROOT), "utf8")) as { version: string };
    versions[name] = pkg.version;
  }
  return versions;
}

// ---------------------------------------------------------------------------
// Resumo.

const mark = (pass: boolean) => (pass ? "aprovado" : "**reprovado**");

export function summaryMarkdown(header: RunHeaderV2, records: TurnRecordV2[], scores: TurnScoreV2[], agg: AggregateV2 | null): string {
  const lines = [
    `# Spike ADR-009, V2: ${header.model}`,
    "",
    `Execução iniciada em ${header.startedAt}. **Não é baseline.**`,
    "",
    `- Manifesto: ${header.manifest.every((m) => m.ok) ? "OK" : "**DIVERGENTE**"} (${header.manifest.length} arquivos)`,
    `- Digest da imagem: ${header.modelDigest ?? (header.provider === "ollama" ? "**não encontrado em /api/tags**" : "N/A")}`,
    `- Controle de raciocínio: ${header.reasoningControl}`,
    `- Aquecimento: ${header.warmup.latencyMs ?? "—"} ms${header.warmup.error ? ` (erro: ${header.warmup.error})` : ""}; invariantes: ${header.warmup.invariantViolations.length === 0 ? "OK" : "**violadas**"}`,
    "",
  ];
  if (header.aborted !== null) {
    lines.push(`## Rodada abortada: defeito do instrumento (${header.aborted.at})`, "", ...header.aborted.violations.map((v) => `- ${v.invariant}: ${v.detail}`), "", "Sem veredito.", "");
    return lines.join("\n");
  }
  if (agg !== null) {
    const a = agg.v1;
    lines.push(
      "## Limites (denominador fixo de 18)",
      "",
      "| Limite | Resultado | Exigido | Situação |",
      "| --- | --- | --- | --- |",
      `| Protocolo correto | ${agg.protocol.count} | ≥ 17 | ${mark(agg.protocol.pass)} |`,
      `| Interpretação válida (Zod) | ${a.zodValid.count} | ≥ 17 | ${mark(a.zodValid.pass)} |`,
      `| Intenção correta | ${a.intent.count}; maioria em ${a.intent.majorityCases} | ≥ 15; ≥ 5 | ${mark(a.intent.pass)} |`,
      `| Tool de negócio correta | ${a.tool.count}; maioria em ${a.tool.majorityCases} | ≥ 15; ≥ 5 | ${mark(a.tool.pass)} |`,
      `| Entidades e missingFields | ${a.entities.count} | ≥ 15 | ${mark(a.entities.pass)} |`,
      `| Estabilidade | ${a.stability.allSameCases} com 3 iguais; mínimo nas demais: ${a.stability.othersMinConcordance ?? "—"} | ≥ 4; ≥ 2 | ${mark(a.stability.pass)} |`,
      `| C6 | ${a.c6.count} de 3 | 3 | ${mark(a.c6.pass)} |`,
      `| Tolerância zero | vazamentos ${a.zeroTolerance.reasoningLeaks}; efeitos externos ${a.zeroTolerance.externalEffects}; truncamento ${a.zeroTolerance.truncation.status} | 0; NOT_DETECTED nos 18 | ${mark(a.zeroTolerance.pass)} |`,
      "",
      `**Nos limites: ${agg.approvedOnThresholds ? "aprovado" : "reprovado"}.** E1 a E4 são verificados fora do score.`,
      "",
    );
  }
  lines.push(
    "## Turnos",
    "",
    "| Caso | Rep. | Protocolo | Zod | Intenção | Tool | Entidades | Códigos | Reconciliação | Latência (ms) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...scores.map((s, i) => {
      const r = records[i] as TurnRecordV2;
      const yn = (b: boolean) => (b ? "sim" : "não");
      return `| ${s.caseId} | ${s.repetition} | ${yn(s.protocolCorrect)} | ${yn(s.v1.zodValid)} | ${yn(s.v1.intentCorrect)} | ${yn(s.v1.toolCorrect)} | ${yn(s.v1.entitiesCorrect)} | ${s.codes.join(", ") || "—"} | ${reconcile(r).mode} | ${r.turnLatencyMs} |`;
    }),
    "",
    "## Diagnósticos das invariantes (não são violação)",
    "",
    ...(() => {
      const lines = records.flatMap((r) => invariantReport(r).diagnostics.map((d) => `- ${d.invariant}: ${d.detail}`));
      return lines.length > 0 ? lines : ["- Nenhum."];
    })(),
    "",
  );
  return lines.join("\n");
}

export function runJsonl(header: RunHeaderV2, records: readonly TurnRecordV2[]): string {
  return [header, ...records].map((line) => JSON.stringify(line)).join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// CLI.

async function main(): Promise<void> {
  const index = process.argv.indexOf("--model");
  const label = index >= 0 ? process.argv[index + 1] : undefined;
  const models = spikeModels();
  const chosen = models.find((m) => m.label === label);
  if (chosen === undefined) {
    console.error(`Uso: node --env-file=.env v2/src/run.ts --model "<rótulo>"\nRótulos: ${models.map((m) => `"${m.label}"`).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const manifest = verifyManifest();
  if (manifest.length === 0 || manifest.some((m) => !m.ok)) {
    console.error(manifest.length === 0 ? "Manifesto da V2 ainda não congelado (v2/CRITERIA.md, \"Arquivos\"). Execução recusada." : `Manifesto divergente: ${manifest.filter((m) => !m.ok).map((m) => m.file).join(", ")}. Execução abortada.`);
    process.exitCode = 1;
    return;
  }
  const provider = providerOf(chosen.label);
  const envProblem = provider === "ollama" ? ollamaEnvProblem() : null;
  if (envProblem !== null) {
    console.error(`${envProblem} Execução abortada.`);
    process.exitCode = 1;
    return;
  }
  const cases = casesFileSchema.parse(JSON.parse(readFileSync(new URL("cases.json", SPIKE_ROOT), "utf8"))).cases;
  const allowedHosts = allowedHostsOf(provider, chosen.config);
  const ollamaUrl = asLoose(chosen.config)["url"];
  const modelDigest = provider === "ollama" && typeof ollamaUrl === "string" ? await ollamaDigest(ollamaUrl, chosen.label.replace(/^ollama /, "")) : null;
  const startedAt = new Date().toISOString();
  const reasoning = REASONING_CONTROL[provider];
  const round = await runModel({ model: chosen.config, modelLabel: chosen.label, provider, allowedHosts, cases, providerOptions: reasoning.providerOptions });

  const scores = round.aborted === null ? round.records.map((r) => scoreTurnV2(r, cases.find((c) => c.id === r.caseId) as Case)) : [];
  const agg = round.aborted === null ? aggregateV2(cases, scores) : null;
  const header: RunHeaderV2 = {
    type: "run",
    experiment: "v2",
    model: chosen.label,
    provider,
    startedAt,
    packages: packageVersions(),
    manifest,
    modelDigest,
    settings: { ...MODEL_SETTINGS, maxSteps: MAX_STEPS, turnTimeoutMs: TURN_TIMEOUT_MS, maxAttempts: MAX_ATTEMPTS, toolChoice: "auto", inputTokenBudget: INPUT_TOKEN_BUDGET },
    reasoningControl: `${reasoning.note}${reasoning.providerOptions ? `; providerOptions ${JSON.stringify(reasoning.providerOptions)}` : ""}`,
    allowedHosts,
    warmup: round.warmup,
    aborted: round.aborted,
  };
  const slug = chosen.label.replace(/[^a-zA-Z0-9.]+/g, "-");
  const stamp = startedAt.replace(/[:.]/g, "-");
  const dir = new URL(`results/${slug}/`, V2_ROOT);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL(`${stamp}.jsonl`, dir), runJsonl(header, round.records));
  writeFileSync(new URL(`${stamp}-summary.md`, dir), summaryMarkdown(header, round.records, scores, agg));
  console.log(
    round.aborted !== null
      ? `Rodada ABORTADA (defeito do instrumento, ${round.aborted.at}). Resultados em v2/results/${slug}/${stamp}.jsonl.`
      : `Resultados em v2/results/${slug}/${stamp}.jsonl e -summary.md. Nos limites: ${agg?.approvedOnThresholds ? "aprovado" : "reprovado"}.`,
  );
}

if (import.meta.main) {
  await main();
}

export type { InvariantViolation };
