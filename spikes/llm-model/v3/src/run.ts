// Execução da V3 do spike do ADR-009 (v3/CRITERIA.md). Uso, depois do congelamento:
//   node --env-file=.env v3/src/run.ts --model "<rótulo>"
// Enquanto o manifesto da V3 não existir, a CLI se recusa a executar.
//
// D1, dois Agents por tentativa:
// - fase 1: as quatro tools de negócio da V1, sem structuredOutput, toolChoice "auto", maxSteps 5,
//   capturadas pelo TurnProtocol da V2.1 (sem a submitInterpretation);
// - fase 2: segundo Agent SEM tools, maxSteps 1, structuredOutput (interpretationSchema da V1) com
//   errorStrategy "warn", recebendo o histórico do caso + a transcrição filtrada da fase 1.
// Prompt da V1 nas duas fases. 180 s por tentativa, compartilhados pelas duas fases. Captura da V3
// por cima do monitor da V2.1; falha do instrumento num latch conferido antes de tudo.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { Agent } from "@mastra/core/agent";
import type { MessageListInput } from "@mastra/core/agent/message-list";
import type { MastraModelConfig } from "@mastra/core/llm";
import { noopLogger } from "@mastra/core/logger";
import { z } from "zod";

import { casesFileSchema, type CasesFile } from "../../src/cases-schema.ts";
import { spikeModels } from "../../src/models.ts";
import { SYSTEM_PROMPT } from "../../src/prompt.ts";
import { INPUT_TOKEN_BUDGET, type ExecCode, type ModelCallRecord, type RateLimitEvent } from "../../src/run-record.ts";
import {
  MODEL_SETTINGS,
  QuotaExhausted,
  REASONING_CONTROL,
  classifyError,
  ollamaEnvProblem,
  redactReasoningText,
  redactReasoningValue,
  sanitize,
  toMessages,
  withSanitizedConsole,
  type ProviderOptionsJson,
} from "../../src/run.ts";
import { interpretationSchema } from "../../src/schema.ts";
import { TOOL_INPUT_SCHEMAS, createFakeTools } from "../../src/tools.ts";
import { TurnProtocol } from "../../v2/src/protocol.ts";
import {
  MAX_ATTEMPTS,
  MAX_STEPS,
  TURN_TIMEOUT_MS,
  allowedHostsOf,
  contextCheckFromCalls,
  contextCheckOf,
  ollamaDigest,
  providerOf,
  verifyManifest,
  withRequestMonitor,
} from "../../v2/src/run.ts";
import { CaptureLayer, normalizeUrl, readInterpretation } from "./phase2.ts";
import type { AttemptV3, FidelityReport, InstrumentFailure, InvariantViolationV3, Phase1Record, Phase2Record, RunHeaderV3, TurnRecordV3 } from "./record.ts";
import type { Aggregate } from "../../src/score.ts";
import { aggregateV3, checkInvariantsV3, combineContextChecks, invariantReportV3, scoreTurnV3, type TurnScoreV3 } from "./score.ts";
import { fidelityA, fidelityB, filterTranscript, transcriptCounts } from "./transcript.ts";

type Case = CasesFile["cases"][number];
type Provider = TurnRecordV3["provider"];
type Loose = Record<string, unknown>;
const asLoose = (value: unknown): Loose => (typeof value === "object" && value !== null ? (value as Loose) : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const numberOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

const SPIKE_ROOT = new URL("../../", import.meta.url);
const V3_ROOT = new URL("../", import.meta.url);

// Fase 2: um passo (v3/CRITERIA.md, "Fase 2").
export const PHASE2_MAX_STEPS = 1;

// ---------------------------------------------------------------------------
// Estimativa local de tokens de entrada por fase (caracteres / 4).

const toolsJsonLength = () => Object.values(TOOL_INPUT_SCHEMAS).map((schema) => JSON.stringify(z.toJSONSchema(schema))).join("").length;

export function estimatePhase1(messages: MessageListInput): number {
  return Math.ceil((SYSTEM_PROMPT.length + toolsJsonLength() + JSON.stringify(messages).length) / 4);
}

export function estimatePhase2(messages: MessageListInput, transcript: readonly unknown[]): number {
  return Math.ceil((SYSTEM_PROMPT.length + JSON.stringify(messages).length + JSON.stringify(transcript).length + JSON.stringify(z.toJSONSchema(interpretationSchema)).length) / 4);
}

// ---------------------------------------------------------------------------
// URL de inferência (POST) do provider configurado, derivada do código instalado:
// - Ollama (model router com url): o Mastra cria createOpenAICompatible({ baseURL: config.url })
//   .chatModel(modelId) (@mastra/core/dist/llm-CSHDOVui.js:8914-8924); a URL é
//   new URL(`${withoutTrailingSlash(baseURL)}${path}`).toString() (netlify-CAH5VW8O.js:4269-4283), e o
//   doGenerate faz POST com path "/chat/completions" (netlify-CAH5VW8O.js:3307-3310).
// - Groq (@ai-sdk/groq): `${withoutTrailingSlash(baseURL) ?? "https://api.groq.com/openai/v1"}${path}`
//   (@ai-sdk/groq/dist/index.js:886-897), mesmo path no doGenerate (index.js:453-456). O próprio
//   modelo expõe essa função em config.url, que é a usada aqui.
// Confirmado contra a URL e o método observados nos testes com HTTP fabricado (provider-path.test.ts).
export const INFERENCE_PATH = "/chat/completions";

export function inferenceEndpointOf(provider: Provider, config: MastraModelConfig): string | null {
  if (provider === "groq") {
    const model = asLoose(config);
    const url = asLoose(model["config"])["url"];
    return typeof url === "function" ? normalizeUrl(String((url as (o: { path: string; modelId: unknown }) => string)({ path: INFERENCE_PATH, modelId: model["modelId"] }))) : null;
  }
  const url = asLoose(config)["url"];
  return typeof url === "string" ? normalizeUrl(`${url.replace(/\/$/, "")}${INFERENCE_PATH}`) : null;
}

// ---------------------------------------------------------------------------
// Uma tentativa.

export interface TurnInputV3 {
  model: MastraModelConfig;
  modelLabel: string;
  provider: Provider;
  testCase: Case;
  repetition: number;
  allowedHosts: readonly string[];
  providerOptions?: ProviderOptionsJson;
  // Só para testes (TEST_HOOKS): modelo da fase 2, orçamento de tempo, falha simulada numa camada do
  // instrumento e monitor de requisições (padrão: o withRequestMonitor da V2.1, sem alteração).
  phase2Model?: MastraModelConfig;
  timeoutMs?: number;
  fault?: (point: FaultPoint) => void;
  monitor?: typeof withRequestMonitor;
}

// Ganchos só para testes. A CLI não os aciona (cliRunOptions), e o cabeçalho da rodada registra quais
// foram usados (testHooksUsed): numa rodada real, nenhum.
export const TEST_HOOKS = ["phase2Model", "timeoutMs", "fault", "monitor", "invariantCheck"] as const;
export const testHooksUsed = (options: object): string[] => TEST_HOOKS.filter((key) => (options as Loose)[key] !== undefined);

// Pontos onde os testes simulam exceção de uma camada do instrumento.
export type FaultPoint = "captura:1" | "captura:2" | "filtro" | "fidelidade";

type ErrorInfo = ReturnType<typeof classifyError>;

export interface AttemptOutcome {
  record: TurnRecordV3;
  // Erro de execução classificado (null sem erro, ou quando houve falha do instrumento).
  error: ErrorInfo | null;
}

// Latência por chamada. Com uma requisição por passo (o caso normal), pelas requisições vistas em
// tempo real: do início desta requisição ao início da próxima (inclui a execução das tools e a
// espera de nova tentativa) e, no último passo, ao fim da resposta. Sem essa correspondência, pelos
// onStepFinish, que o Mastra pode adiar (pausa de limite de taxa; v3/src/provider-path.test.ts).
function callsOf(steps: Loose[], stamps: number[], start: number, requests: { start: number; end: number | null }[] = []): ModelCallRecord[] {
  const byRequest = requests.length === steps.length && requests.length > 0;
  return steps.map((step, index) => {
    const usage = asLoose(step["usage"]);
    const request = requests[index];
    const end = byRequest && request !== undefined ? (requests[index + 1]?.start ?? request.end ?? performance.now()) : (stamps[index] ?? performance.now());
    const previous = byRequest && request !== undefined ? request.start : index === 0 ? start : (stamps[index - 1] ?? start);
    return {
      index,
      inputTokens: numberOrNull(usage["inputTokens"]),
      outputTokens: numberOrNull(usage["outputTokens"]),
      latencyMs: Math.round(end - previous),
      finishReason: typeof step["finishReason"] === "string" ? step["finishReason"] : null,
    };
  });
}

// Falha de uma chamada ao Agent: a exceção, o erro do resultado ou o cancelamento. No Mastra 1.81.0,
// quando o sinal de cancelamento dispara, o generate NÃO lança: devolve finishReason "aborted", sem
// passos e sem error (medido; v3/src/retry.test.ts). O motivo do sinal (TimeoutError) é classificado
// pelo classifyError da V1 como EXEC_TIMEOUT.
const failureOf = (result: Loose, thrown: unknown, signal: AbortSignal): unknown => {
  if (thrown !== undefined) return thrown;
  const e = result["error"];
  if (e !== undefined && e !== null) return e;
  if (result["finishReason"] === "aborted") return signal.reason ?? Object.assign(new Error("geração cancelada"), { name: "AbortError" });
  return undefined;
};

const separatePresentOf = (result: Loose, steps: Loose[]) =>
  asArray(result["reasoning"]).length > 0 || (typeof result["reasoningText"] === "string" && result["reasoningText"].length > 0) || steps.some((s) => asArray(s["reasoning"]).length > 0);

export async function runAttempt(input: TurnInputV3, attempt: number): Promise<AttemptOutcome> {
  const { testCase } = input;
  const fault = input.fault;
  const layer = new CaptureLayer(fault === undefined ? undefined : (phase) => fault(`captura:${phase}`), {
    1: inferenceEndpointOf(input.provider, input.model),
    2: inferenceEndpointOf(input.provider, input.phase2Model ?? input.model),
  });
  const protocol = new TurnProtocol();
  const { tools, calls: toolLog } = createFakeTools();
  const phase1Agent = new Agent({ id: "spike-adr009-v3-fase1", name: "spike-adr009-v3-fase1", instructions: SYSTEM_PROMPT, model: input.model, tools });
  const phase2Agent = new Agent({ id: "spike-adr009-v3-fase2", name: "spike-adr009-v3-fase2", instructions: SYSTEM_PROMPT, model: input.phase2Model ?? input.model });
  phase1Agent.__setLogger(noopLogger);
  phase2Agent.__setLogger(noopLogger);
  const messages = toMessages(testCase);
  const startedAt = new Date().toISOString();
  // Um único sinal por tentativa, compartilhado pelas duas fases (não reinicia entre elas).
  const signal = AbortSignal.timeout(input.timeoutMs ?? TURN_TIMEOUT_MS);
  const start = performance.now();

  let p1: Loose = {};
  let p1Thrown: unknown;
  const p1Stamps: number[] = [];
  const p1Finished: Loose[] = [];
  let p1Start = start;
  let p1End = start;
  let toolLogAtPhase1End: { tool: string; args: unknown }[] = [];
  let transcript: unknown[] | null = null;
  let p2: Loose = {};
  let p2Thrown: unknown;
  const p2Stamps: number[] = [];
  const p2Finished: Loose[] = [];
  let p2Start = start;
  let p2End = start;
  let phase2Invocations = 0;
  let external: string[] = [];

  const monitor = input.monitor ?? withRequestMonitor;
  // Passos da fase 1 delimitados pelo início de cada requisição DE INFERÊNCIA (POST para a URL de
  // inferência do provider; inferenceEndpointOf), em tempo real, não pelo onStepFinish:
  // o Mastra pode adiar os onStepFinish (pausa de limite de taxa) enquanto o laço continua, e o
  // TurnProtocol fundiria passos distintos (falsa I1 e falsa I10). O TurnProtocol da V2.1 não muda:
  // a V3 só decide quando chamar o onStepFinish() dele.
  let phase1Requests = 0;
  layer.onDelegate = (phase) => {
    if (phase !== 1) return;
    if (phase1Requests > 0) protocol.onStepFinish();
    phase1Requests += 1;
  };
  try {
    // captura (topo) → monitor da V2.1 → sentinela (base) → fetch original.
    const monitored = await layer.aroundBottom(() => monitor(input.allowedHosts, () =>
      layer.around(() =>
        withSanitizedConsole(async () => {
          layer.phase = 1;
          p1Start = performance.now();
          try {
            p1 = asLoose(
              await phase1Agent.generate(messages, {
                modelSettings: { ...MODEL_SETTINGS },
                maxSteps: MAX_STEPS,
                toolChoice: "auto",
                abortSignal: signal,
                providerOptions: input.providerOptions,
                hooks: protocol.hooks,
                onChunk: protocol.onChunk,
                onStepFinish: (step: unknown) => {
                  p1Stamps.push(performance.now());
                  p1Finished.push(asLoose(step));
                },
              } as never),
            );
          } catch (error) {
            p1Thrown = error;
          } finally {
            // Fecha o último passo da fase 1 (os anteriores foram fechados pela requisição seguinte),
            // também quando o generate lança.
            if (phase1Requests > 0) protocol.onStepFinish();
          }
          p1End = performance.now();
          toolLogAtPhase1End = toolLog.map((e) => ({ tool: e.tool, args: e.args }));
          // Latch: falha do instrumento na fase 1 encerra a tentativa antes de qualquer classificação.
          if (layer.failures.length > 0) return;
          // Fase 1 em EXEC_*: a fase 2 não roda.
          if (failureOf(p1, p1Thrown, signal) !== undefined) return;
          try {
            fault?.("filtro");
            transcript = filterTranscript(asArray(asLoose(p1["response"])["messages"]));
          } catch (error) {
            layer.fail("filtro", 1, error);
            return;
          }
          layer.phase = 2;
          phase2Invocations += 1;
          p2Start = performance.now();
          try {
            p2 = asLoose(
              await phase2Agent.generate([...(messages as unknown[]), ...transcript] as MessageListInput, {
                structuredOutput: { schema: interpretationSchema, errorStrategy: "warn" },
                modelSettings: { ...MODEL_SETTINGS },
                maxSteps: PHASE2_MAX_STEPS,
                abortSignal: signal,
                providerOptions: input.providerOptions,
                onStepFinish: (step: unknown) => {
                  p2Stamps.push(performance.now());
                  p2Finished.push(asLoose(step));
                },
              } as never),
            );
          } catch (error) {
            p2Thrown = error;
          }
          p2End = performance.now();
        }),
      ),
    ));
    external = monitored.external;
  } catch (error) {
    // O que escapa daqui vem do monitor (as chamadas ao Agent e o filtro capturam os próprios erros).
    layer.fail("monitor", layer.phase, `exceção do monitor: ${sanitize(error instanceof Error ? `${error.name}: ${error.message}` : String(error))}`);
  }
  const turnLatencyMs = Math.round(performance.now() - start);

  // --- Fase 1.
  const p1Steps = asArray(p1["steps"]).length > 0 ? asArray(p1["steps"]).map(asLoose) : p1Finished;
  const p1Failure = failureOf(p1, p1Thrown, signal);
  const p1Error = p1Failure === undefined ? null : classifyError(p1Failure);
  const p1Calls = callsOf(p1Steps, p1Stamps, p1Start, layer.requests.filter((r) => r.phase === 1));
  const p1Text = redactReasoningText(p1Steps.map((s) => (typeof s["text"] === "string" ? s["text"] : "")).filter(Boolean).join("\n"));
  const phase1: Phase1Record = {
    status: p1Error === null ? "completed" : "execution_error",
    execError: p1Error === null ? null : { code: p1Error.code, message: p1Error.message },
    emitted: protocol.emitted,
    steps: protocol.steps(),
    executions: protocol.executions,
    toolLog: toolLogAtPhase1End.map((e) => ({ tool: e.tool, args: e.args })),
    calls: p1Calls,
    text: p1Text.text,
    reasoning: { separatePresent: separatePresentOf(p1, p1Steps), leakedInText: p1Text.leaked, leakedInArgs: protocol.leakedInArgs },
    contextCheck: contextCheckFromCalls(p1Calls, estimatePhase1(messages)),
    latencyMs: Math.round(p1End - p1Start),
    modelRequests: layer.requests.filter((r) => r.phase === 1).length,
    transcript: transcriptCounts(transcript ?? []),
  };

  // --- Fase 2.
  let phase2: Phase2Record | null = null;
  let p2Error: ErrorInfo | null = null;
  if (phase2Invocations > 0) {
    const p2Steps = asArray(p2["steps"]).length > 0 ? asArray(p2["steps"]).map(asLoose) : p2Finished;
    const p2Failure = failureOf(p2, p2Thrown, signal);
    p2Error = p2Failure === undefined ? null : classifyError(p2Failure);
    const p2Calls = callsOf(p2Steps, p2Stamps, p2Start, layer.requests.filter((r) => r.phase === 2));
    const finishReason = typeof p2["finishReason"] === "string" ? p2["finishReason"] : null;
    const rawText = typeof p2["text"] === "string" ? p2["text"] : "";
    const official = readInterpretation(rawText, finishReason);
    const redactedText = redactReasoningText(rawText);
    const redactedInterpretation = redactReasoningValue(official.value);
    const zod = interpretationSchema.safeParse(redactedInterpretation.value);
    // result.object: diagnóstico; checagem de vazamento sobre o valor original, gravado redigido.
    const objectValue = p2["object"];
    const redactedObject = redactReasoningValue(objectValue ?? null);
    const toolCallNames = p2Steps.flatMap((s) => asArray(s["toolCalls"]).map((c) => String(asLoose(asLoose(c)["payload"] ?? c)["toolName"] ?? "")));
    const validInterpretations = p2Steps
      .filter((s) => !["retry", "error"].includes(String(s["finishReason"] ?? "")))
      .filter((s) => {
        const r = readInterpretation(typeof s["text"] === "string" ? s["text"] : "", typeof s["finishReason"] === "string" ? s["finishReason"] : null);
        return r.parse === "OK" && interpretationSchema.safeParse(redactReasoningValue(r.value).value).success;
      }).length;
    phase2 = {
      // Lista de passos completa, exceto na fase 2 cancelada por tempo (finishReason "aborted"). Mesmo
      // quando o generate lança (ex.: 500 persistente), os passos retry/error chegam pelo onStepFinish.
      stepsObservable: finishReason !== "aborted",
      status: p2Error === null ? "completed" : "execution_error",
      execError: p2Error === null ? null : { code: p2Error.code, message: p2Error.message },
      calls: p2Calls,
      finishReason,
      text: redactedText.text,
      interpretationRaw: redactedInterpretation.value,
      parse: official.parse,
      zodValid: zod.success,
      zodIssues: zod.success ? [] : zod.error.issues.map((issue) => `${issue.path.join(".") || "(raiz)"}: ${issue.message}`),
      mastraObject: redactedObject.value,
      mastraObjectPresent: objectValue !== undefined && objectValue !== null,
      toolCalls: { count: toolCallNames.length, names: toolCallNames },
      validInterpretations,
      request: layer.requestSummary(),
      toolLogGrowth: toolLog.length - toolLogAtPhase1End.length,
      reasoning: {
        separatePresent: separatePresentOf(p2, p2Steps),
        leakedInText: redactedText.leaked,
        leakedInInterpretation: redactedInterpretation.leaked,
        leakedInObject: redactedObject.leaked,
      },
      contextCheck: contextCheckFromCalls(p2Calls, estimatePhase2(messages, transcript ?? [])),
      latencyMs: Math.round(p2End - p2Start),
    };
  }

  // --- Transcrição fiel (I10): A (captura × transcrição) e B (transcrição × corpo real da fase 2).
  const fidelity: FidelityReport = { violations: [], diagnostics: [] };
  try {
    if (transcript !== null) {
      fault?.("fidelidade");
      const a = fidelityA(protocol.emitted, transcript);
      fidelity.violations.push(...a.violations);
      fidelity.diagnostics.push(...a.diagnostics);
      for (const body of layer.phase2Bodies) {
        const b = fidelityB(transcript, body.messages, layer.firstPhase1MessageCount);
        fidelity.violations.push(...b.violations);
        fidelity.diagnostics.push(...b.diagnostics);
      }
    }
  } catch (error) {
    layer.fail("fidelidade", 2, error);
  }

  // Latch: com falha do instrumento, nada é classificado como EXEC_*.
  const defect = layer.failures.length > 0;
  const error = defect ? null : (p1Error ?? p2Error);
  const record: TurnRecordV3 = {
    type: "turn",
    experiment: "v3",
    model: input.modelLabel,
    provider: input.provider,
    caseId: testCase.id,
    repetition: input.repetition,
    startedAt,
    attempt,
    attempts: attempt,
    status: defect ? "instrument_defect" : error === null ? "completed" : "execution_error",
    execError: error === null ? null : { code: error.code, message: error.message, status: error.status },
    phase1,
    phase2,
    phase2Invocations,
    fidelity,
    instrumentFailures: [...layer.failures],
    rateLimits: [],
    previousAttempts: [],
    contextCheck: combineContextChecks(phase1.contextCheck, phase2?.contextCheck ?? null),
    turnLatencyMs,
    externalRequests: external,
  };
  return { record, error };
}

// ---------------------------------------------------------------------------
// Defeito do instrumento: invariante violada ou falha registrada no latch. Aborta a rodada.

export class InstrumentDefect extends Error {
  readonly record: TurnRecordV3;
  readonly violations: InvariantViolationV3[];
  readonly failures: InstrumentFailure[];
  constructor(record: TurnRecordV3, violations: InvariantViolationV3[], failures: InstrumentFailure[]) {
    super(`defeito do instrumento: ${[...violations.map((v) => v.invariant), ...failures.map((f) => `falha (${f.layer})`)].join(", ")}`);
    this.record = record;
    this.violations = violations;
    this.failures = failures;
  }
}

const attemptOf = (record: TurnRecordV3): AttemptV3 => ({
  attempt: record.attempt,
  status: record.status,
  execError: record.execError,
  phase1: record.phase1,
  phase2: record.phase2,
  phase2Invocations: record.phase2Invocations,
  fidelity: record.fidelity,
  instrumentFailures: record.instrumentFailures,
});

function diagnose(input: TurnInputV3, attempt: number, error: ErrorInfo): void {
  const status = error.status === null ? "" : ` (HTTP ${error.status})`;
  console.error(sanitize(`[spike v3] ${input.testCase.id}, repetição ${input.repetition}, tentativa ${attempt}: ${error.code}${status}: ${error.message}`));
}

// Novas tentativas como na V1 e na V2.1: um 429 em qualquer fase repete o turno inteiro, até 3
// tentativas, cada uma com orçamento de tempo novo. Depois de cada tentativa, nesta ordem: latch de
// falha do instrumento, invariantes, e só então classificação e decisão de nova tentativa.
export async function runTurn(input: TurnInputV3, invariantCheck: (record: TurnRecordV3) => InvariantViolationV3[] = checkInvariantsV3): Promise<TurnRecordV3> {
  const rateLimits: RateLimitEvent[] = [];
  const previousAttempts: AttemptV3[] = [];
  const finish = (outcome: AttemptOutcome): TurnRecordV3 => {
    outcome.record.rateLimits = rateLimits;
    outcome.record.previousAttempts = previousAttempts;
    return outcome.record;
  };
  let last: AttemptOutcome | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    last = await runAttempt(input, attempt);
    const record = finish(last);
    if (record.instrumentFailures.length > 0) throw new InstrumentDefect(record, [], record.instrumentFailures);
    let violations: InvariantViolationV3[];
    try {
      violations = invariantCheck(record);
    } catch (error) {
      const failure: InstrumentFailure = { layer: "reconciliação", phase: null, detail: sanitize(error instanceof Error ? `${error.name}: ${error.message}` : String(error)) };
      record.instrumentFailures.push(failure);
      record.status = "instrument_defect";
      throw new InstrumentDefect(record, [], [failure]);
    }
    if (violations.length > 0) throw new InstrumentDefect(record, violations, []);
    const err = last.error;
    if (err !== null) diagnose(input, attempt, err);
    if (err === null || err.status !== 429) break;
    const willRetry = !err.daily && attempt < MAX_ATTEMPTS;
    const waitSeconds = willRetry ? Math.max(1, err.retryAfterSeconds ?? 2 ** attempt) : null;
    rateLimits.push({ attempt, at: new Date().toISOString(), status: err.status, code: err.code, daily: err.daily, retryAfterSeconds: err.retryAfterSeconds, waitSeconds });
    if (err.daily) throw Object.assign(new QuotaExhausted("cota diária esgotada"), { record });
    if (waitSeconds !== null) {
      previousAttempts.push(attemptOf(record));
      await sleep(waitSeconds * 1000);
    }
  }
  if (last === undefined) throw new Error("nenhuma tentativa executada");
  return finish(last);
}

const emptyPhase1 = (): Phase1Record => ({
  status: "execution_error",
  execError: null,
  emitted: [],
  steps: [],
  executions: [],
  toolLog: [],
  calls: [],
  text: "",
  reasoning: { separatePresent: false, leakedInText: false, leakedInArgs: false },
  contextCheck: contextCheckOf(null, 0, true),
  latencyMs: 0,
  modelRequests: 0,
  transcript: { messages: 0, assistantWithToolCalls: 0, toolMessages: 0 },
});

// Turno não executado (cota diária esgotada antes dele): sem requisições.
function notExecuted(input: Omit<TurnInputV3, "model">): TurnRecordV3 {
  const execError = { code: "EXEC_QUOTA" as ExecCode, message: "não executado: cota diária esgotada antes deste turno" };
  return {
    type: "turn",
    experiment: "v3",
    model: input.modelLabel,
    provider: input.provider,
    caseId: input.testCase.id,
    repetition: input.repetition,
    startedAt: new Date().toISOString(),
    attempt: 0,
    attempts: 0,
    status: "execution_error",
    execError,
    phase1: { ...emptyPhase1(), execError },
    phase2: null,
    phase2Invocations: 0,
    fidelity: { violations: [], diagnostics: [] },
    instrumentFailures: [],
    rateLimits: [],
    previousAttempts: [],
    contextCheck: contextCheckOf(null, 0, true),
    turnLatencyMs: 0,
    externalRequests: [],
  };
}

// ---------------------------------------------------------------------------
// Uma rodada: aquecimento + 18 turnos.

export interface RunOptionsV3 {
  model: MastraModelConfig;
  modelLabel: string;
  provider: Provider;
  allowedHosts: readonly string[];
  cases: readonly Case[];
  providerOptions?: ProviderOptionsJson;
  // Só para testes (TEST_HOOKS).
  invariantCheck?: (record: TurnRecordV3) => InvariantViolationV3[];
  fault?: (point: FaultPoint) => void;
  phase2Model?: MastraModelConfig;
  timeoutMs?: number;
  monitor?: typeof withRequestMonitor;
}

// Opções da rodada real, montadas pela CLI: nunca contêm ganchos de teste.
export function cliRunOptions(model: MastraModelConfig, modelLabel: string, provider: Provider, allowedHosts: readonly string[], cases: readonly Case[], providerOptions: ProviderOptionsJson | undefined): RunOptionsV3 {
  return { model, modelLabel, provider, allowedHosts, cases, providerOptions };
}

export interface RoundResultV3 {
  warmup: RunHeaderV3["warmup"];
  records: TurnRecordV3[];
  aborted: RunHeaderV3["aborted"];
}

const abortedFrom = (at: string, error: InstrumentDefect) => ({ at, reason: error.message, violations: error.violations, failures: error.failures });

export async function runModel(options: RunOptionsV3): Promise<RoundResultV3> {
  const check = options.invariantCheck ?? checkInvariantsV3;
  const records: TurnRecordV3[] = [];
  let warmup: RunHeaderV3["warmup"] = { latencyMs: null, error: null, invariantViolations: [] };
  let at = "aquecimento";
  try {
    const warmupCase: Case = { ...(options.cases[0] as Case), history: [], input: "Olá." };
    const outcome = await runAttempt({ ...options, testCase: warmupCase, repetition: 0 }, 1);
    if (outcome.record.instrumentFailures.length > 0) {
      warmup = { latencyMs: outcome.record.turnLatencyMs, error: null, invariantViolations: [] };
      return { warmup, records, aborted: abortedFrom(at, new InstrumentDefect(outcome.record, [], outcome.record.instrumentFailures)) };
    }
    const invariantViolations = check(outcome.record);
    warmup = { latencyMs: outcome.record.turnLatencyMs, error: outcome.error?.message ?? null, invariantViolations };
    if (invariantViolations.length > 0) return { warmup, records, aborted: { at, reason: "violação de invariante no aquecimento", violations: invariantViolations, failures: [] } };

    let quotaExhausted = false;
    for (const testCase of options.cases) {
      for (const repetition of [1, 2, 3]) {
        const turnInput = { ...options, testCase, repetition };
        at = `${testCase.id}, repetição ${repetition}`;
        if (quotaExhausted) {
          const record = notExecuted(turnInput);
          records.push(record);
          const violations = check(record);
          if (violations.length > 0) return { warmup, records, aborted: { at, reason: "violação de invariante", violations, failures: [] } };
          continue;
        }
        try {
          records.push(await runTurn(turnInput, check));
        } catch (error) {
          if (error instanceof InstrumentDefect) {
            records.push(error.record);
            return { warmup, records, aborted: abortedFrom(at, error) };
          }
          if (!(error instanceof QuotaExhausted)) throw error;
          quotaExhausted = true;
          records.push((error as QuotaExhausted & { record: TurnRecordV3 }).record);
        }
      }
    }
    return { warmup, records, aborted: null };
  } catch (error) {
    // Exceção inesperada: a rodada é abortada com o motivo; o arquivo de resultados é gravado.
    const reason = `exceção inesperada: ${sanitize(error instanceof Error ? `${error.name}: ${error.message}` : String(error))}`;
    return { warmup, records, aborted: { at, reason, violations: [], failures: [{ layer: "orquestração", phase: null, detail: reason }] } };
  }
}

// ---------------------------------------------------------------------------
// Manifesto (v3/CRITERIA.md, "Arquivos"), resumo e gravação.

export const readCriteria = () => readFileSync(new URL("CRITERIA.md", V3_ROOT), "utf8");
export const verifyManifestV3 = (criteriaText = readCriteria()) => verifyManifest(criteriaText);

function packageVersions(): Record<string, string> {
  const versions: Record<string, string> = { node: process.version };
  for (const name of ["@mastra/core", "@ai-sdk/groq", "zod"]) {
    const pkg = JSON.parse(readFileSync(new URL(`node_modules/${name}/package.json`, SPIKE_ROOT), "utf8")) as { version: string };
    versions[name] = pkg.version;
  }
  return versions;
}

const mark = (pass: boolean) => (pass ? "aprovado" : "**reprovado**");

export function summaryMarkdown(header: RunHeaderV3, records: TurnRecordV3[], scores: TurnScoreV3[], agg: Aggregate | null): string {
  const lines = [
    `# Spike ADR-009, V3: ${header.model}`,
    "",
    `Execução iniciada em ${header.startedAt}. **Não é baseline.**`,
    "",
    `- Manifesto: ${header.manifest.length > 0 && header.manifest.every((m) => m.ok) ? "OK" : "**DIVERGENTE ou ausente**"} (${header.manifest.length} arquivos)`,
    `- Digest da imagem: ${header.modelDigest ?? (header.provider === "ollama" ? "**não encontrado em /api/tags**" : "N/A")}`,
    `- Controle de raciocínio: ${header.reasoningControl}`,
    `- Aquecimento: ${header.warmup.latencyMs ?? "—"} ms${header.warmup.error ? ` (erro: ${header.warmup.error})` : ""}; invariantes: ${header.warmup.invariantViolations.length === 0 ? "OK" : "**violadas**"}`,
    "",
  ];
  if (header.aborted !== null) {
    lines.push(
      `## Rodada abortada: defeito do instrumento (${header.aborted.at})`,
      "",
      `Motivo: ${header.aborted.reason}`,
      "",
      ...header.aborted.violations.map((v) => `- ${v.invariant}: ${v.detail}`),
      ...header.aborted.failures.map((f) => `- falha do instrumento (${f.layer}, fase ${f.phase ?? "—"}): ${f.detail}`),
      "",
      "Sem veredito.",
      "",
    );
    return lines.join("\n");
  }
  if (agg !== null) {
    const a = agg;
    lines.push(
      "## Limites (denominador fixo de 18)",
      "",
      "| Limite | Resultado | Exigido | Situação |",
      "| --- | --- | --- | --- |",
      `| Interpretação válida (Zod) | ${a.zodValid.count} | ≥ 17 | ${mark(a.zodValid.pass)} |`,
      `| Intenção correta | ${a.intent.count}; maioria em ${a.intent.majorityCases} | ≥ 15; ≥ 5 | ${mark(a.intent.pass)} |`,
      `| Tool de negócio correta | ${a.tool.count}; maioria em ${a.tool.majorityCases} | ≥ 15; ≥ 5 | ${mark(a.tool.pass)} |`,
      `| Entidades e missingFields | ${a.entities.count} | ≥ 15 | ${mark(a.entities.pass)} |`,
      `| Estabilidade | ${a.stability.allSameCases} com 3 iguais; mínimo nas demais: ${a.stability.othersMinConcordance ?? "—"} | ≥ 4; ≥ 2 | ${mark(a.stability.pass)} |`,
      `| C6 | ${a.c6.count} de 3 | 3 | ${mark(a.c6.pass)} |`,
      `| Tolerância zero | vazamentos ${a.zeroTolerance.reasoningLeaks}; efeitos externos ${a.zeroTolerance.externalEffects}; truncamento ${a.zeroTolerance.truncation.status} | 0; NOT_DETECTED nos 18 | ${mark(a.zeroTolerance.pass)} |`,
      "",
      `**Nos limites: ${a.approvedOnThresholds ? "aprovado" : "reprovado"}.** E1 a E4 são verificados fora do score.`,
      "",
    );
  }
  const yn = (b: boolean) => (b ? "sim" : "não");
  lines.push(
    "## Turnos",
    "",
    "| Caso | Rep. | Zod | Intenção | Tool | Entidades | Códigos | Leitura da fase 2 | `object` do Mastra | Tool calls na fase 2 | Truncamento | Latência (ms) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...scores.map((s, i) => {
      const r = records[i] as TurnRecordV3;
      return `| ${s.caseId} | ${s.repetition} | ${yn(s.v1.zodValid)} | ${yn(s.v1.intentCorrect)} | ${yn(s.v1.toolCorrect)} | ${yn(s.v1.entitiesCorrect)} | ${s.codes.join(", ") || "—"} | ${s.phase2Parse ?? "não executada"} | ${s.mastraObjectPresent ? "presente" : "ausente"} | ${s.phase2ToolCalls} | ${r.contextCheck.status} | ${r.turnLatencyMs} |`;
    }),
    "",
    "## Diagnósticos das invariantes (não são violação)",
    "",
    ...(() => {
      const found = records.flatMap((r) => invariantReportV3(r).diagnostics.map((d) => `- ${d.invariant}: ${d.detail}`));
      return found.length > 0 ? found : ["- Nenhum."];
    })(),
    "",
  );
  return lines.join("\n");
}

export function runJsonl(header: RunHeaderV3, records: readonly TurnRecordV3[]): string {
  return [header, ...records].map((line) => JSON.stringify(line)).join("\n") + "\n";
}

// Grava o arquivo de resultados (inclusive de rodada abortada, com o motivo).
export function writeRound(dir: URL, stamp: string, header: RunHeaderV3, records: TurnRecordV3[], scores: TurnScoreV3[], agg: Aggregate | null): { jsonl: URL; summary: URL } {
  mkdirSync(dir, { recursive: true });
  const jsonl = new URL(`${stamp}.jsonl`, dir);
  const summary = new URL(`${stamp}-summary.md`, dir);
  writeFileSync(jsonl, runJsonl(header, records));
  writeFileSync(summary, summaryMarkdown(header, records, scores, agg));
  return { jsonl, summary };
}

// ---------------------------------------------------------------------------
// CLI.

async function main(): Promise<void> {
  const index = process.argv.indexOf("--model");
  const label = index >= 0 ? process.argv[index + 1] : undefined;
  const models = spikeModels().filter((m) => m.label.startsWith("ollama "));
  const chosen = models.find((m) => m.label === label);
  if (chosen === undefined) {
    console.error(`Uso: node --env-file=.env v3/src/run.ts --model "<rótulo>"\nRótulos (Groq fora da V3): ${models.map((m) => `"${m.label}"`).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const manifest = verifyManifestV3();
  if (manifest.length === 0 || manifest.some((m) => !m.ok)) {
    console.error(manifest.length === 0 ? "Manifesto da V3 ainda não congelado (v3/CRITERIA.md, \"Arquivos\"). Execução recusada." : `Manifesto divergente: ${manifest.filter((m) => !m.ok).map((m) => m.file).join(", ")}. Execução abortada.`);
    process.exitCode = 1;
    return;
  }
  const provider = providerOf(chosen.label);
  const envProblem = ollamaEnvProblem();
  if (envProblem !== null) {
    console.error(`${envProblem} Execução abortada.`);
    process.exitCode = 1;
    return;
  }
  const cases = casesFileSchema.parse(JSON.parse(readFileSync(new URL("cases.json", SPIKE_ROOT), "utf8"))).cases;
  const allowedHosts = allowedHostsOf(provider, chosen.config);
  const ollamaUrl = asLoose(chosen.config)["url"];
  const modelDigest = typeof ollamaUrl === "string" ? await ollamaDigest(ollamaUrl, chosen.label.replace(/^ollama /, "")).catch(() => null) : null;
  const startedAt = new Date().toISOString();
  const reasoning = REASONING_CONTROL[provider];
  const options = cliRunOptions(chosen.config, chosen.label, provider, allowedHosts, cases, reasoning.providerOptions);
  let round: RoundResultV3;
  try {
    round = await runModel(options);
  } catch (error) {
    const reason = `exceção inesperada: ${sanitize(String(error))}`;
    round = { warmup: { latencyMs: null, error: null, invariantViolations: [] }, records: [], aborted: { at: "rodada", reason, violations: [], failures: [{ layer: "orquestração", phase: null, detail: reason }] } };
  }
  let scores: TurnScoreV3[] = [];
  if (round.aborted === null) scores = round.records.map((r) => scoreTurnV3(r, cases.find((c) => c.id === r.caseId) as Case));
  const agg = round.aborted === null ? aggregateV3(cases, scores) : null;
  const header: RunHeaderV3 = {
    type: "run",
    experiment: "v3",
    model: chosen.label,
    provider,
    startedAt,
    packages: packageVersions(),
    manifest,
    modelDigest,
    settings: { ...MODEL_SETTINGS, phase1MaxSteps: MAX_STEPS, phase2MaxSteps: PHASE2_MAX_STEPS, attemptTimeoutMs: TURN_TIMEOUT_MS, maxAttempts: MAX_ATTEMPTS, toolChoice: "auto", inputTokenBudget: INPUT_TOKEN_BUDGET },
    reasoningControl: `${reasoning.note}${reasoning.providerOptions ? `; providerOptions ${JSON.stringify(reasoning.providerOptions)}` : ""}`,
    allowedHosts,
    warmup: round.warmup,
    aborted: round.aborted,
    testHooksUsed: testHooksUsed(options),
  };
  const slug = chosen.label.replace(/[^a-zA-Z0-9.]+/g, "-");
  const stamp = startedAt.replace(/[:.]/g, "-");
  const files = writeRound(new URL(`results/${slug}/`, V3_ROOT), stamp, header, round.records, scores, agg);
  console.log(
    round.aborted !== null
      ? `Rodada ABORTADA (defeito do instrumento, ${round.aborted.at}): ${round.aborted.reason}. Resultados em ${files.jsonl.pathname}.`
      : `Resultados em ${files.jsonl.pathname} e -summary.md. Nos limites: ${agg?.approvedOnThresholds ? "aprovado" : "reprovado"}.`,
  );
  if (round.aborted !== null) process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
