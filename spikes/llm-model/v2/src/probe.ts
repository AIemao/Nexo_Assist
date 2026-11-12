// Sondagens de capacidade P1–P4 da V2 (v2/CRITERIA.md, "Sondagens de capacidade"). FORA do
// manifesto: usa o instrumento congelado sem alterá-lo.
//
//   node --env-file=.env v2/src/probe.ts --model "<rótulo>"
//
// - Caminho: runTurn da V2 (o mesmo das rodadas), com o REASONING_CONTROL, as configurações e as
//   tools falsas da V1 (sem efeito real), e as invariantes I1–I5 conferidas por tentativa.
// - Contexto como no aquecimento: o primeiro caso como molde, histórico vazio, entrada própria.
// - Três entradas próprias, fixas e idênticas entre os modelos; nenhuma dos seis casos; sem pontuação.
// - Uma execução por entrada. Nova tentativa do runTurn só em 429 (política congelada), o que não
//   é repetir a sondagem. Erro pontual numa entrada é registrado e não impede as demais; cota
//   diária esgotada é terminal para o modelo: as entradas restantes ficam "não executadas".
// - Comportamentos do instrumento congelado (Mastra 1.81.0), medidos e visíveis no registro, não
//   corrigidos aqui (mastra-behavior.test.ts):
//   - em HTTP 500 e 429 o Mastra repete a requisição duas vezes por conta própria (passos com
//     finishReason "retry"), e esses passos NÃO contam no maxSteps;
//   - o Mastra espera 10 s ao fim de cada passo quando o cabeçalho x-ratelimit-remaining-tokens
//     está entre 1 e 1999 (agent-DtdQ6un6.js:52747); a sondagem conta a PRESENÇA de cabeçalhos de
//     limite nas respostas (sem ler nem gravar nomes ou valores).
// - P1: o corpo da requisição é observado envolvendo o fetch POR FORA do runTurn; só tool_choice,
//   stream e a presença de response_format são lidos; o resto é descartado. Aceitação HTTP (2xx) é
//   separada do resultado do turno; observabilidade parcial do corpo é explícita.
// - P2, P3 (instrumento) e P4 por TENTATIVA (as anteriores a um 429 tratado pelo runTurn incluídas),
//   com tentativa e passo identificados. P3 também no nível do provider (contagens na resposta; o SDK
//   compatível com OpenAI gera um id quando o provider omite).
// - Persistência: só metadados (nomes, passos, contagens, status, validade). Nenhum argumento,
//   resposta, texto ou raciocínio. Antes de gravar, o conteúdo é conferido contra padrões proibidos.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import type { MastraModelConfig } from "@mastra/core/llm";

import { casesFileSchema, type CasesFile } from "../../src/cases-schema.ts";
import { spikeModels } from "../../src/models.ts";
import { BUSINESS_TOOLS, type ModelCallRecord } from "../../src/run-record.ts";
import { QuotaExhausted, REASONING_CONTROL, ollamaEnvProblem, sanitize, type ProviderOptionsJson } from "../../src/run.ts";
import { SUBMIT_TOOL, type AcceptedSubmission, type EmittedCall, type InvariantViolation, type TurnRecordV2 } from "./record.ts";
import { InstrumentDefect, MAX_STEPS, allowedHostsOf, ollamaDigest, providerOf, runTurn, verifyManifest, type Provider } from "./run.ts";
import { checkInvariants, invariantReport } from "./score.ts";

type Case = CasesFile["cases"][number];
type Loose = Record<string, unknown>;
const asLoose = (value: unknown): Loose => (typeof value === "object" && value !== null ? (value as Loose) : {});

const SPIKE_ROOT = new URL("../../", import.meta.url);
const V2_ROOT = new URL("../", import.meta.url);

// Entradas próprias da sondagem: fixas, idênticas entre os modelos, fora dos seis casos.
export const PROBE_INPUTS = [
  { id: "SONDA-1", purpose: "pedido de tool de negócio (listagem de chamados)", input: "Pode me mostrar tudo o que eu já abri com o suporte?" },
  { id: "SONDA-2", purpose: "pedido sem tool de negócio (saudação)", input: "Bom dia! Tudo certo por aí?" },
  { id: "SONDA-3", purpose: "pedido que convida a duas tools (artigos + chamados)", input: "Como eu troco a senha do e-mail? E aproveita e me diz como estão os meus pedidos." },
] as const;

export const GROQ_PAUSE_MS = 60_000;
const EXPECTED_MANIFEST_FILES = 28;
const EXPECTED_SERVER_CONTEXT = 8192;
// Padrões que nunca podem ir para disco (CRITERIA da V1 e da V2, "Registros").
export const FORBIDDEN = /authorization|bearer|gsk_|x-ratelimit/i;
// Nome de cabeçalho de limite de taxa: só a presença é contada; nome e valor nunca são guardados.
const RATE_LIMIT_HEADER = /^x-ratelimit-/i;

// ---------------------------------------------------------------------------
// P1: requisição e resposta observadas no caminho real (fetch envolvido por fora do runTurn).

export interface ObservedRequest {
  // O corpo era JSON legível? Se não, os campos do corpo ficam null (indisponível).
  bodyObserved: boolean;
  toolChoice: string | null;
  toolChoicePresent: boolean | null;
  stream: boolean | null;
  responseFormatPresent: boolean | null;
  status: number | null;
  networkError: string | null;
  // Contagens das chamadas de tool NA RESPOSTA do provider (antes do SDK, que gera um id quando o
  // provider omite): só números; nenhum id, argumento ou texto é guardado. null se ilegível.
  providerToolCalls: { total: number; withId: number; duplicatedIds: number } | null;
  // Quantos cabeçalhos de limite de taxa a resposta trouxe (só a contagem). null sem resposta.
  rateLimitHeaderCount: number | null;
  // O host é o endpoint do modelo (allowedHosts)? Só o booleano; a URL não é guardada. null sem lista.
  modelEndpoint: boolean | null;
}

export async function withRequestCapture<T>(fn: () => Promise<T>, allowedHosts?: readonly string[]): Promise<{ result: T; requests: ObservedRequest[] }> {
  const original = globalThis.fetch;
  const requests: ObservedRequest[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const entry: ObservedRequest = {
      bodyObserved: false,
      toolChoice: null,
      toolChoicePresent: null,
      stream: null,
      responseFormatPresent: null,
      status: null,
      networkError: null,
      providerToolCalls: null,
      rateLimitHeaderCount: null,
      modelEndpoint: null,
    };
    if (allowedHosts !== undefined) {
      try {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        entry.modelEndpoint = allowedHosts.includes(new URL(url).host);
      } catch {
        entry.modelEndpoint = false;
      }
    }
    if (typeof init?.body === "string") {
      try {
        // Só três campos; o corpo inteiro (mensagens, prompt, tools) é descartado aqui.
        const body = asLoose(JSON.parse(init.body));
        entry.bodyObserved = true;
        entry.toolChoicePresent = "tool_choice" in body;
        const tc = body["tool_choice"];
        entry.toolChoice = "tool_choice" in body ? sanitize(typeof tc === "string" ? tc : JSON.stringify(tc)).slice(0, 120) : null;
        entry.stream = body["stream"] === true;
        entry.responseFormatPresent = "response_format" in body;
      } catch {
        entry.bodyObserved = false;
      }
    }
    requests.push(entry);
    try {
      const response = await original(input, init);
      entry.status = response.status;
      // Só a contagem de nomes que casam; nenhum nome ou valor é guardado.
      let count = 0;
      response.headers.forEach((_value, name) => {
        if (RATE_LIMIT_HEADER.test(name)) count += 1;
      });
      entry.rateLimitHeaderCount = count;
      try {
        // Cópia da resposta: o original segue intacto para o SDK. Só contagens são extraídas.
        const json = asLoose(await response.clone().json());
        const choices = Array.isArray(json["choices"]) ? json["choices"] : null;
        if (choices !== null) {
          const message = asLoose(asLoose(choices[0])["message"]);
          const calls = (Array.isArray(message["tool_calls"]) ? message["tool_calls"] : []).map(asLoose);
          const ids = calls.map((c) => c["id"]).filter((id): id is string => typeof id === "string" && id !== "");
          entry.providerToolCalls = { total: calls.length, withId: ids.length, duplicatedIds: ids.length - new Set(ids).size };
        }
      } catch {
        entry.providerToolCalls = null;
      }
      return response;
    } catch (error) {
      entry.networkError = sanitize(String(asLoose(error)["message"] ?? error));
      throw error;
    }
  }) as typeof fetch;
  try {
    return { result: await fn(), requests };
  } finally {
    globalThis.fetch = original;
  }
}

export type ProbeOutcome = "completed" | "execution_error" | "instrument_defect" | "quota_exhausted" | "not_executed_quota" | "failed";

// P1 a partir das requisições observadas. Aceitação HTTP (respostas 2xx) é separada do resultado do
// turno (runTurn). O tool_choice só é "observed" se TODOS os corpos foram lidos; "partial" se só
// alguns; "unavailable" se nenhum.
export function p1Of(requests: readonly ObservedRequest[], outcome: ProbeOutcome) {
  const observed = requests.filter((r) => r.bodyObserved);
  const values = [...new Set(observed.filter((r) => r.toolChoicePresent).map((r) => r.toolChoice as string))];
  const statuses = requests.map((r) => r.status);
  const count2xx = statuses.filter((s) => s !== null && s >= 200 && s < 300).length;
  const withResponse = requests.filter((r) => r.rateLimitHeaderCount !== null);
  return {
    requests: [...requests],
    httpStatuses: statuses,
    providerAccepted: requests.length === 0 ? null : { all: count2xx === requests.length, count2xx, total: requests.length },
    turnCompleted: outcome === "completed",
    toolChoice: {
      status: (observed.length === 0 ? "unavailable" : observed.length === requests.length ? "observed" : "partial") as "observed" | "partial" | "unavailable",
      values,
      observedBodies: observed.length,
      unobservedBodies: requests.length - observed.length,
    },
    rateLimitHeaders: { responses: withResponse.length, responsesWithAny: withResponse.filter((r) => (r.rateLimitHeaderCount ?? 0) > 0).length },
  };
}

// ---------------------------------------------------------------------------
// P2–P4 por tentativa, a partir do registro observado (nada presumido).

export type CallKind = "business" | "submit" | "other";
const kindOf = (name: string): CallKind => (name === SUBMIT_TOOL ? "submit" : (BUSINESS_TOOLS as readonly string[]).includes(name) ? "business" : "other");

// Uma tentativa do runTurn: as anteriores (interrompidas por 429) e a última.
export interface AttemptData {
  attempt: number;
  errorCode: string | null;
  emitted: readonly EmittedCall[];
  calls: readonly ModelCallRecord[];
  acceptedSubmissions: readonly AcceptedSubmission[];
}

export function attemptsOf(record: TurnRecordV2): AttemptData[] {
  return [
    ...record.previousAttempts.map((p) => ({ attempt: p.attempt, errorCode: p.error.code, emitted: p.emitted, calls: p.calls, acceptedSubmissions: p.acceptedSubmissions })),
    { attempt: record.attempts, errorCode: record.execError?.code ?? null, emitted: record.emitted, calls: record.calls, acceptedSubmissions: record.acceptedSubmissions },
  ];
}

export function p2Calls(a: Pick<AttemptData, "emitted" | "acceptedSubmissions">) {
  const calls = [...a.emitted]
    .sort((x, y) => x.order - y.order)
    .map((call) => ({ step: call.step, toolName: call.toolName, kind: kindOf(call.toolName), validAtCapture: call.validAtCapture, toolCallIdPresent: call.toolCallId !== null && call.toolCallId !== "" }));
  const submissions = calls.filter((c) => c.kind === "submit").length;
  return { calls, submissionEmitted: submissions > 0, submissionsEmitted: submissions, submissionAccepted: a.acceptedSubmissions.length > 0 };
}

// P3 no nível do instrumento (ids como o registro os viu, depois do SDK), dentro de uma tentativa.
export function p3Ids(a: Pick<AttemptData, "emitted">) {
  const ids = a.emitted.map((call) => call.toolCallId).filter((id): id is string => id !== null && id !== "");
  const unique = new Set(ids).size;
  return { calls: a.emitted.length, present: ids.length, missing: a.emitted.length - ids.length, duplicated: ids.length - unique, allPresentAndUnique: ids.length === a.emitted.length && unique === ids.length };
}

// P3 no nível do provider: somado das respostas observadas (o SDK gera id quando o provider omite,
// então só aqui se vê a omissão). Duplicados contados por resposta (passo). null se nenhuma legível.
export function p3Provider(requests: readonly ObservedRequest[]) {
  const seen = requests.map((r) => r.providerToolCalls).filter((c): c is NonNullable<ObservedRequest["providerToolCalls"]> => c !== null);
  if (seen.length === 0) return null;
  const total = seen.reduce((n, c) => n + c.total, 0);
  const withId = seen.reduce((n, c) => n + c.withId, 0);
  return { calls: total, withId, missing: total - withId, duplicatedInSameResponse: seen.reduce((n, c) => n + c.duplicatedIds, 0) };
}

export function p4PerStep(a: Pick<AttemptData, "emitted" | "calls">) {
  const indices = new Set<number>([...a.calls.map((c) => c.index), ...a.emitted.map((e) => e.step)]);
  return [...indices]
    .sort((x, y) => x - y)
    .map((step) => {
      const inStep = a.emitted.filter((e) => e.step === step);
      const business = inStep.filter((e) => kindOf(e.toolName) === "business").length;
      const submit = inStep.filter((e) => kindOf(e.toolName) === "submit").length;
      return {
        step,
        total: inStep.length,
        business,
        submit,
        other: inStep.length - business - submit,
        parallel: inStep.length > 1,
        finishReason: a.calls.find((c) => c.index === step)?.finishReason ?? null,
      };
    });
}

// A tentativa terminou só com texto, sem submissão: último passo sem emissão, "stop", nenhuma submissão.
export function endedWithTextOnly(a: Pick<AttemptData, "emitted" | "calls">): boolean {
  const last = [...a.calls].sort((x, y) => x.index - y.index).at(-1);
  if (last === undefined) return false;
  const emittedInLast = a.emitted.some((e) => e.step === last.index);
  return last.finishReason === "stop" && !emittedInLast && !a.emitted.some((e) => e.toolName === SUBMIT_TOOL);
}

// Métricas de uma tentativa. Passos "retry" (novas tentativas internas do Mastra) não contam no
// maxSteps (medido em mastra-behavior.test.ts): o limite é atingido com MAX_STEPS passos não-retry.
// reachedStepLimitThresholdWithRetries (diagnóstico, sem pontuação): a tentativa teve pelo menos
// MAX_STEPS passos não-retry, pelo menos um passo retry e nenhuma submissão aceita. É uma CONDIÇÃO
// OBSERVADA nos dados da tentativa, não a confirmação de que o limite de passos causou o encerramento
// (a tentativa pode ter terminado por outro motivo no mesmo ponto).
export function attemptMetrics(a: AttemptData) {
  const retrySteps = a.calls.filter((c) => c.finishReason === "retry").length;
  const nonRetrySteps = a.calls.length - retrySteps;
  const submissionAccepted = a.acceptedSubmissions.length > 0;
  return {
    attempt: a.attempt,
    errorCode: a.errorCode,
    p2: p2Calls(a),
    p3: p3Ids(a),
    p4: p4PerStep(a),
    retrySteps,
    nonRetrySteps,
    endedWithTextOnly: endedWithTextOnly(a),
    reachedStepLimitThresholdWithRetries: !submissionAccepted && nonRetrySteps >= MAX_STEPS && retrySteps > 0,
  };
}

// Detalhe de invariante sem argumentos: a chave "nome|argumentos" das mensagens da reconciliação e
// qualquer trecho JSON (que pode conter argumentos) são cortados.
export const stripArgs = (detail: string) => sanitize(detail.replace(/\|[\s\S]*$/u, "|…").replace(/[{[][\s\S]*$/u, "{…}"));

export function integrityOf(record: TurnRecordV2) {
  const report = invariantReport(record);
  return {
    violations: report.violations.map((v) => ({ invariant: v.invariant, detail: stripArgs(v.detail) })),
    diagnostics: report.diagnostics.map((d) => ({ invariant: d.invariant, detail: stripArgs(d.detail) })),
  };
}

// ---------------------------------------------------------------------------
// Uma entrada e a sondagem completa.

export interface ProbeEntryRecord {
  type: "probe";
  experiment: "v2";
  entry: string;
  purpose: string;
  outcome: ProbeOutcome;
  error: { code: string | null; message: string } | null;
  latencyMs: number | null;
  p1: ReturnType<typeof p1Of>;
  // P3 do provider, de todas as respostas observadas da entrada.
  p3Provider: ReturnType<typeof p3Provider>;
  // P2, P3 (instrumento) e P4 por tentativa do runTurn, em ordem.
  attempts: ReturnType<typeof attemptMetrics>[] | null;
  rateLimits: { attempt: number; status: number | null; retryAfterSeconds: number | null; waitSeconds: number | null }[];
  integrity: ReturnType<typeof integrityOf> | null;
  // Efeitos de TODAS as tentativas: requisições fora do endpoint do modelo (observadas pelo fetch
  // envolvido por fora do runTurn) e execuções das tools falsas da V1 (toolLog de cada tentativa).
  effects: { externalRequests: number; fakeToolExecutions: number | null };
}

export interface ProbeOptions {
  model: MastraModelConfig;
  modelLabel: string;
  provider: Provider;
  allowedHosts: readonly string[];
  providerOptions?: ProviderOptionsJson;
  templateCase: Case;
  inputs?: readonly { id: string; purpose: string; input: string }[];
  pauseMs?: number;
  pause?: (ms: number) => Promise<unknown>;
  // Só para testes: substitui o verificador de invariantes do runTurn.
  invariantCheck?: (record: TurnRecordV2) => InvariantViolation[];
}

function entryFrom(id: string, purpose: string, outcome: ProbeOutcome, record: TurnRecordV2 | null, requests: ObservedRequest[], error: ProbeEntryRecord["error"]): ProbeEntryRecord {
  return {
    type: "probe",
    experiment: "v2",
    entry: id,
    purpose,
    outcome,
    error,
    latencyMs: record?.turnLatencyMs ?? null,
    p1: p1Of(requests, outcome),
    p3Provider: p3Provider(requests),
    attempts: record === null ? null : attemptsOf(record).map(attemptMetrics),
    rateLimits: (record?.rateLimits ?? []).map((r) => ({ attempt: r.attempt, status: r.status, retryAfterSeconds: r.retryAfterSeconds, waitSeconds: r.waitSeconds })),
    integrity: record === null ? null : integrityOf(record),
    effects: {
      externalRequests: requests.filter((r) => r.modelEndpoint === false).length,
      fakeToolExecutions: record === null ? null : record.toolLog.length + record.previousAttempts.reduce((n, p) => n + p.toolLog.length, 0),
    },
  };
}

export async function probeEntry(options: ProbeOptions, probe: { id: string; purpose: string; input: string }): Promise<ProbeEntryRecord> {
  const testCase: Case = { ...options.templateCase, id: probe.id, history: [], input: probe.input };
  const turnInput = { model: options.model, modelLabel: options.modelLabel, provider: options.provider, testCase, repetition: 1, allowedHosts: options.allowedHosts, providerOptions: options.providerOptions };
  const captured = await withRequestCapture(async () => {
    try {
      const record = await runTurn(turnInput, options.invariantCheck ?? checkInvariants);
      return { outcome: (record.status === "completed" ? "completed" : "execution_error") as ProbeOutcome, record, error: record.execError };
    } catch (error) {
      if (error instanceof InstrumentDefect) return { outcome: "instrument_defect" as const, record: error.record, error: { code: "INSTRUMENT_DEFECT", message: error.message } };
      if (error instanceof QuotaExhausted) {
        const record = (error as QuotaExhausted & { record: TurnRecordV2 }).record;
        return { outcome: "quota_exhausted" as const, record, error: record.execError };
      }
      return { outcome: "failed" as const, record: null, error: { code: null, message: sanitize(String(asLoose(error)["message"] ?? error)) } };
    }
  }, options.allowedHosts);
  const { outcome, record, error } = captured.result;
  return entryFrom(probe.id, probe.purpose, outcome, record, captured.requests, error === null ? null : { code: error.code, message: sanitize(error.message) });
}

// Entrada não executada porque a cota diária acabou numa entrada anterior: nenhuma requisição.
function notExecutedQuota(probe: { id: string; purpose: string }): ProbeEntryRecord {
  return entryFrom(probe.id, probe.purpose, "not_executed_quota", null, [], { code: "EXEC_QUOTA", message: "não executada: cota diária esgotada numa entrada anterior" });
}

export async function runProbes(options: ProbeOptions): Promise<ProbeEntryRecord[]> {
  const inputs = options.inputs ?? PROBE_INPUTS;
  const pauseMs = options.pauseMs ?? (options.provider === "groq" ? GROQ_PAUSE_MS : 0);
  const pause = options.pause ?? sleep;
  const entries: ProbeEntryRecord[] = [];
  let quotaExhausted = false;
  for (const [i, probe] of inputs.entries()) {
    // Cota diária esgotada é terminal para o modelo: nenhuma requisição a mais.
    if (quotaExhausted) {
      entries.push(notExecutedQuota(probe));
      continue;
    }
    if (i > 0 && pauseMs > 0) await pause(pauseMs);
    const entry = await probeEntry(options, probe);
    entries.push(entry);
    if (entry.outcome === "quota_exhausted") quotaExhausted = true;
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Metadados do modelo e do servidor (fora do turno monitorado).

export async function digestOf(provider: Provider, config: MastraModelConfig, label: string): Promise<string> {
  if (provider !== "ollama") return "não aplicável";
  const url = asLoose(config)["url"];
  if (typeof url !== "string") return "indisponível (sem url na configuração)";
  try {
    return (await ollamaDigest(url, label.replace(/^ollama /, ""))) ?? "indisponível (modelo ausente de /api/tags)";
  } catch (error) {
    return `indisponível (${sanitize(String(asLoose(error)["message"] ?? error))})`;
  }
}

// Contexto do servidor Ollama para o modelo, observado em /api/ps DEPOIS das entradas (o modelo
// só aparece carregado depois de usado).
export async function serverContextOf(provider: Provider, config: MastraModelConfig, label: string, fetchImpl: typeof fetch = fetch): Promise<number | string> {
  if (provider !== "ollama") return "não aplicável";
  const url = asLoose(config)["url"];
  if (typeof url !== "string") return "indisponível (sem url na configuração)";
  try {
    const response = await fetchImpl(`${url.replace(/\/v1\/?$/, "")}/api/ps`);
    if (!response.ok) return `indisponível (HTTP ${response.status})`;
    const models = asLoose(await response.json())["models"];
    const name = label.replace(/^ollama /, "");
    const entry = (Array.isArray(models) ? models : []).map(asLoose).find((m) => m["name"] === name || m["model"] === name);
    const context = entry?.["context_length"];
    return typeof context === "number" ? context : "indisponível (modelo não carregado ou campo ausente em /api/ps)";
  } catch (error) {
    return `indisponível (${sanitize(String(asLoose(error)["message"] ?? error))})`;
  }
}

export function modelIdOf(config: MastraModelConfig): string {
  const c = asLoose(config);
  if (typeof c["id"] === "string") return c["id"];
  return [c["provider"], c["modelId"]].filter((v) => typeof v === "string").join(" / ") || "indisponível";
}

// ---------------------------------------------------------------------------
// Arquivos de saída: JSONL (cabeçalho + uma linha por entrada) e resumo .md.

export interface ProbeHeader {
  type: "probe-run";
  experiment: "v2";
  model: string;
  modelId: string;
  provider: Provider;
  startedAt: string;
  digest: string;
  serverContext: number | string;
  expectedServerContext: number | "não aplicável";
  manifest: { files: number; ok: number };
  reasoningControl: string;
  pauseMs: number;
  inputs: readonly { id: string; purpose: string; input: string }[];
}

export function summaryMarkdown(header: ProbeHeader, entries: readonly ProbeEntryRecord[]): string {
  const yn = (b: boolean | null) => (b === null ? "—" : b ? "sim" : "não");
  const responses = entries.reduce((n, e) => n + e.p1.rateLimitHeaders.responses, 0);
  const withHeaders = entries.reduce((n, e) => n + e.p1.rateLimitHeaders.responsesWithAny, 0);
  const lines = [
    `# Sondagem V2 (P1–P4): ${header.model}`,
    "",
    `${header.startedAt}. Fora dos seis casos; sem pontuação. Identificador: \`${header.modelId}\`.`,
    "",
    `- Digest: ${header.digest}`,
    `- Contexto do servidor (/api/ps, depois das entradas): ${header.serverContext}${header.expectedServerContext === "não aplicável" ? "" : header.serverContext === header.expectedServerContext ? " (conferido: 8192)" : ` (**esperado ${header.expectedServerContext}**)`}`,
    `- Manifesto da V2: ${header.manifest.ok}/${header.manifest.files}`,
    `- Controle de raciocínio: ${header.reasoningControl}`,
    `- Pausa entre entradas: ${header.pauseMs} ms`,
    `- Respostas com cabeçalho de limite de taxa: ${withHeaders} de ${responses} (só presença; a pausa de 10 s do Mastra depende desse cabeçalho)`,
    "",
    "## Por entrada",
    "",
    "| Entrada | Desfecho | P1 tool_choice | P1 HTTP 2xx | Turno concluído | HTTP | P3 provider (com id/sem id/duplicados) | Tentativas | Invariantes | Latência (ms) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...entries.map((e) => {
      const tc = e.p1.toolChoice.status === "unavailable" ? "indisponível" : `${e.p1.toolChoice.values.join(", ") || "(ausente)"}${e.p1.toolChoice.status === "partial" ? ` (parcial: ${e.p1.toolChoice.unobservedBodies} corpo(s) ilegível(is))` : ""}`;
      const acc = e.p1.providerAccepted === null ? "—" : `${e.p1.providerAccepted.count2xx}/${e.p1.providerAccepted.total}`;
      const pv = e.p3Provider === null ? "indisponível" : `${e.p3Provider.withId}/${e.p3Provider.missing}/${e.p3Provider.duplicatedInSameResponse}`;
      const inv = e.integrity === null ? "—" : e.integrity.violations.length === 0 ? `OK${e.integrity.diagnostics.length ? ` (${e.integrity.diagnostics.length} diagnóstico)` : ""}` : `**${e.integrity.violations.map((v) => v.invariant).join(", ")}**`;
      return `| ${e.entry} | ${e.outcome}${e.error ? ` (${e.error.code ?? "erro"})` : ""} | ${tc} | ${acc} | ${yn(e.p1.turnCompleted)} | ${e.p1.httpStatuses.join(", ") || "—"} | ${pv} | ${e.attempts?.length ?? 0} | ${inv} | ${e.latencyMs ?? "—"} |`;
    }),
    "",
    "## Por tentativa (P2, P3 instrumento, P4)",
    "",
    "| Entrada | Tentativa | Erro | P2 chamadas (passo:nome) | Submissão emitida / aceita | P3 instrumento (presentes/ausentes/duplicados) | P4 paralelas | Passos retry / não-retry | Limiar de passos atingido, com retry, sem submissão (observado) | Só texto |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...entries.flatMap((e) =>
      (e.attempts ?? []).map((a) => {
        const calls = a.p2.calls.map((c) => `${c.step}:${c.toolName}`).join(", ") || "—";
        const par = a.p4.filter((s) => s.parallel).map((s) => `passo ${s.step} (${s.total})`).join(", ") || "nenhuma";
        return `| ${e.entry} | ${a.attempt} | ${a.errorCode ?? "—"} | ${calls} | ${yn(a.p2.submissionEmitted)} / ${yn(a.p2.submissionAccepted)} | ${a.p3.present}/${a.p3.missing}/${a.p3.duplicated} | ${par} | ${a.retrySteps} / ${a.nonRetrySteps} | ${yn(a.reachedStepLimitThresholdWithRetries)} | ${yn(a.endedWithTextOnly)} |`;
      }),
    ),
    "",
    "## Por passo (P4) e finishReason",
    "",
    ...entries.flatMap((e) =>
      (e.attempts ?? []).map((a) => `- ${e.entry}, tentativa ${a.attempt}: ${a.p4.map((s) => `passo ${s.step}: ${s.total} chamada(s) (negócio ${s.business}, submissão ${s.submit}, outras ${s.other}), ${s.finishReason ?? "—"}`).join("; ") || "—"}`),
    ),
    "",
  ];
  return lines.join("\n");
}

export function serialize(header: ProbeHeader, entries: readonly ProbeEntryRecord[]): { jsonl: string; markdown: string } {
  const jsonl = [header, ...entries].map((line) => JSON.stringify(line)).join("\n") + "\n";
  const markdown = summaryMarkdown(header, entries);
  // Conferência antes de gravar: nenhum padrão proibido em nenhum dos dois arquivos.
  for (const [name, text] of [["jsonl", jsonl], ["md", markdown]] as const) {
    const hit = FORBIDDEN.exec(text);
    if (hit !== null) throw new Error(`registro de sondagem (${name}) contém padrão proibido: ${hit[0]}`);
  }
  return { jsonl, markdown };
}

export function writeProbeFiles(header: ProbeHeader, entries: readonly ProbeEntryRecord[], outDir: URL = new URL("results/probes/", V2_ROOT)): { jsonl: URL; markdown: URL } {
  const { jsonl, markdown } = serialize(header, entries);
  const slug = header.model.replace(/[^a-zA-Z0-9.]+/g, "-");
  const stamp = header.startedAt.replace(/[:.]/g, "-");
  mkdirSync(outDir, { recursive: true });
  const jsonlUrl = new URL(`${slug}-${stamp}.jsonl`, outDir);
  const mdUrl = new URL(`${slug}-${stamp}.md`, outDir);
  writeFileSync(jsonlUrl, jsonl);
  writeFileSync(mdUrl, markdown);
  return { jsonl: jsonlUrl, markdown: mdUrl };
}

// ---------------------------------------------------------------------------
// CLI.

async function main(): Promise<void> {
  const index = process.argv.indexOf("--model");
  const label = index >= 0 ? process.argv[index + 1] : undefined;
  const models = spikeModels();
  const chosen = models.find((m) => m.label === label);
  if (chosen === undefined) {
    console.error(`Uso: node --env-file=.env v2/src/probe.ts --model "<rótulo>"\nRótulos: ${models.map((m) => `"${m.label}"`).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const manifest = verifyManifest();
  const okCount = manifest.filter((m) => m.ok).length;
  if (manifest.length !== EXPECTED_MANIFEST_FILES || okCount !== manifest.length) {
    console.error(`Manifesto da V2 divergente (${okCount}/${manifest.length}; esperado ${EXPECTED_MANIFEST_FILES}). Sondagem recusada.`);
    process.exitCode = 1;
    return;
  }
  const provider = providerOf(chosen.label);
  const envProblem = provider === "ollama" ? ollamaEnvProblem() : null;
  if (envProblem !== null) {
    console.error(`${envProblem} Sondagem recusada.`);
    process.exitCode = 1;
    return;
  }
  const cases = casesFileSchema.parse(JSON.parse(readFileSync(new URL("cases.json", SPIKE_ROOT), "utf8"))).cases;
  const reasoning = REASONING_CONTROL[provider];
  const startedAt = new Date().toISOString();
  const digest = await digestOf(provider, chosen.config, chosen.label);
  const options: ProbeOptions = {
    model: chosen.config,
    modelLabel: chosen.label,
    provider,
    allowedHosts: allowedHostsOf(provider, chosen.config),
    providerOptions: reasoning.providerOptions,
    templateCase: cases[0] as Case,
  };
  const entries = await runProbes(options);
  const header: ProbeHeader = {
    type: "probe-run",
    experiment: "v2",
    model: chosen.label,
    modelId: modelIdOf(chosen.config),
    provider,
    startedAt,
    digest,
    serverContext: await serverContextOf(provider, chosen.config, chosen.label),
    expectedServerContext: provider === "ollama" ? EXPECTED_SERVER_CONTEXT : "não aplicável",
    manifest: { files: manifest.length, ok: okCount },
    reasoningControl: `${reasoning.note}${reasoning.providerOptions ? `; providerOptions ${JSON.stringify(reasoning.providerOptions)}` : ""}`,
    pauseMs: provider === "groq" ? GROQ_PAUSE_MS : 0,
    inputs: PROBE_INPUTS,
  };
  const files = writeProbeFiles(header, entries);
  console.log(`Sondagem gravada: ${files.jsonl.pathname} e ${files.markdown.pathname}`);
  for (const e of entries) {
    const last = e.attempts?.at(-1);
    console.log(`- ${e.entry}: ${e.outcome}; tool_choice ${e.p1.toolChoice.status} ${JSON.stringify(e.p1.toolChoice.values)}; tentativas ${e.attempts?.length ?? 0}; submissão aceita ${last?.p2.submissionAccepted ?? "—"}; invariantes ${e.integrity?.violations.length ?? "—"}`);
  }
}

if (import.meta.main) {
  await main();
}
