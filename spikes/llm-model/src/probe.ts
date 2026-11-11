// Sondagem de capacidades do spike do ADR-009 (Fase 2a, autorizada pelo autor em 2026-11-11).
// FORA dos seis casos congelados e do denominador de 18: duas chamadas por modelo, com entradas
// próprias da sondagem, pelo mesmo caminho do run (agent do Mastra, modelSettings, providerOptions).
//
//   node --env-file=.env src/probe.ts                      # os três modelos
//   node --env-file=.env src/probe.ts --model "<rótulo>"   # um modelo
//
// Chamada A: parâmetro de controle de raciocínio + seed 42. Chamada B: limite de saída pequeno
// com um pedido maior que ele. Registra o payload enviado (sem cabeçalhos; mensagens reduzidas à
// contagem) e, da resposta, só finish_reason, uso de tokens, presença e tamanho do raciocínio
// (nunca o conteúdo) e o Retry-After em segundos (cabeçalhos x-ratelimit-* não são gravados).
// Saída: results/probes/<modelo>/<instante>.{json,md}.
//
//   node --env-file=.env src/probe.ts --control --model "ollama qwen3:8b"
//
// Chamada de controle (só Ollama): igual à chamada A, mas SEM o parâmetro de raciocínio, mais as
// capacidades do /api/show; compara com a chamada A mais recente do mesmo modelo.
// Saída: results/probes/<modelo>/<instante>-control.{json,md}.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import { noopLogger } from "@mastra/core/logger";

import { spikeModels } from "./models.ts";
import { classifyError, ollamaEnvProblem, retryAfterSecondsOf, sanitize, withSanitizedConsole, type ProviderOptionsJson } from "./run.ts";

const ROOT = new URL("../", import.meta.url);

type ProbeProvider = "ollama" | "groq";

// Parâmetro de controle de raciocínio aplicável a cada caminho, como enviado pelo Mastra:
// - Ollama (endpoint compatível com OpenAI, via model router "ollama/…"): reasoningEffort "none"
//   no namespace "ollama" (primeiro segmento do id), que o provider compatível com OpenAI envia
//   como reasoning_effort.
// - Groq (@ai-sdk/groq): reasoningFormat "hidden" (reasoning_format). Suprime o campo de
//   raciocínio na resposta; NÃO desliga o raciocínio do gpt-oss.
const REASONING_PARAM: Record<ProbeProvider, { providerOptions: ProviderOptionsJson; payloadKey: string; expected: unknown }> = {
  ollama: { providerOptions: { ollama: { reasoningEffort: "none" } }, payloadKey: "reasoning_effort", expected: "none" },
  groq: { providerOptions: { groq: { reasoningFormat: "hidden" } }, payloadKey: "reasoning_format", expected: "hidden" },
};

const SEED = 42;
const LIMIT_A = 256;
const LIMIT_B = 16;
const INPUT_A = "Responda em uma frase curta: qual é a capital do Brasil?";
const INPUT_B = "Escreva os números de 1 a 300 em português por extenso, um por linha, sem mais nada.";

interface Exchange {
  url: string;
  status: number | null;
  payload: Record<string, unknown> | null;
  response: {
    finishReason: string | null;
    usage: unknown;
    reasoningFieldPresent: boolean;
    reasoningLength: number;
    thinkTagInContent: boolean;
    contentLength: number;
  } | null;
  retryAfterSeconds: number | null;
}

// Payload sem conteúdo de conversa: mensagens viram contagem; o resto (parâmetros) fica.
function summarizePayload(body: unknown): Record<string, unknown> | null {
  if (typeof body !== "string") return null;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key === "messages" || key === "input") out[key] = `[${Array.isArray(value) ? value.length : 1} mensagem(ns) omitida(s)]`;
      else if (key === "tools") out[key] = Array.isArray(value) ? `[${value.length} tool(s)]` : value;
      else out[key] = value;
    }
    return out;
  } catch {
    return { body: "[não é JSON]" };
  }
}

// Da resposta (chat completions): só metadados; nunca o texto nem o raciocínio.
function summarizeResponse(json: unknown): Exchange["response"] {
  const root = (json ?? {}) as Record<string, unknown>;
  const choice = (Array.isArray(root["choices"]) ? root["choices"][0] : undefined) as Record<string, unknown> | undefined;
  const message = (choice?.["message"] ?? {}) as Record<string, unknown>;
  const content = typeof message["content"] === "string" ? message["content"] : "";
  const reasoning = [message["reasoning"], message["reasoning_content"]].find((v) => typeof v === "string" && v.length > 0) as string | undefined;
  return {
    finishReason: typeof choice?.["finish_reason"] === "string" ? (choice["finish_reason"] as string) : null,
    usage: root["usage"] ?? null,
    reasoningFieldPresent: reasoning !== undefined,
    reasoningLength: reasoning?.length ?? 0,
    thinkTagInContent: /<think>|<\|channel\|>analysis/i.test(content),
    contentLength: content.length,
  };
}

async function capture<T>(fn: () => Promise<T>): Promise<{ result: T | undefined; error: unknown; exchanges: Exchange[] }> {
  const original = globalThis.fetch;
  const exchanges: Exchange[] = [];
  globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const exchange: Exchange = { url: new URL(url).origin + new URL(url).pathname, status: null, payload: summarizePayload(init?.body), response: null, retryAfterSeconds: null };
    exchanges.push(exchange);
    const response = await original(input, init);
    exchange.status = response.status;
    exchange.retryAfterSeconds = retryAfterSecondsOf(response.headers.get("retry-after"));
    try {
      exchange.response = summarizeResponse(await response.clone().json());
    } catch {
      exchange.response = null;
    }
    return response;
  };
  try {
    return { result: await fn(), error: undefined, exchanges };
  } catch (error) {
    return { result: undefined, error, exchanges };
  } finally {
    globalThis.fetch = original;
  }
}

function agentFor(model: MastraModelConfig): Agent {
  const agent = new Agent({ id: "spike-probe", name: "spike-probe", instructions: "Você é um assistente. Responda em português.", model });
  agent.__setLogger(noopLogger);
  return agent;
}

async function call(model: MastraModelConfig, prompt: string, maxOutputTokens: number, providerOptions: ProviderOptionsJson) {
  const agent = agentFor(model);
  return withSanitizedConsole(() =>
    capture(async () => {
      const result = await agent.generate(prompt, {
        modelSettings: { temperature: 0, seed: SEED, maxOutputTokens, maxRetries: 0 },
        providerOptions,
      });
      const failure = (result as { error?: unknown }).error;
      if (failure !== undefined) throw failure;
      return {
        finishReason: (result as { finishReason?: unknown }).finishReason ?? null,
        usage: (result as { totalUsage?: unknown }).totalUsage ?? null,
        reasoningSeparate: ((result as { reasoning?: unknown[] }).reasoning ?? []).length > 0,
      };
    }),
  );
}

function errorOf(error: unknown): { code: string; status: number | null; message: string } | null {
  if (error === undefined) return null;
  const info = classifyError(error);
  return { code: info.code, status: info.status, message: info.message };
}

function modelCall(exchanges: Exchange[]): Exchange | undefined {
  return exchanges.find((e) => /chat\/completions|\/responses/.test(e.url)) ?? exchanges[0];
}

async function probe(label: string, provider: ProbeProvider, model: MastraModelConfig) {
  const reasoning = REASONING_PARAM[provider];

  // Chamada A: raciocínio + seed.
  const a = await call(model, INPUT_A, LIMIT_A, reasoning.providerOptions);
  const ex = modelCall(a.exchanges);
  const payload = ex?.payload ?? {};
  const transmitted = payload[reasoning.payloadKey] === reasoning.expected;
  const accepted = ex?.status !== null && ex?.status !== undefined && ex.status < 400 && a.error === undefined;
  const resp = ex?.response;
  const usageDetails = JSON.stringify(resp?.usage ?? {});
  const reasoningTokens = /"reasoning_tokens":\s*(\d+)/.exec(usageDetails)?.[1];
  let reasoningVerdict: string;
  if (!transmitted) reasoningVerdict = "NOT_TRANSMITTED";
  else if (!accepted) reasoningVerdict = "REJECTED";
  else if (resp === null || resp === undefined) reasoningVerdict = "UNKNOWN";
  else if (resp.reasoningFieldPresent || resp.thinkTagInContent || a.result?.reasoningSeparate) reasoningVerdict = "REASONING_PRESENT";
  else if (provider === "groq") reasoningVerdict = "REASONING_HIDDEN";
  else reasoningVerdict = "NO_REASONING_OBSERVED";

  const callA = {
    input: INPUT_A,
    reasoningParam: { key: reasoning.payloadKey, value: reasoning.expected, providerOptions: reasoning.providerOptions },
    reasoningTransmitted: transmitted,
    accepted,
    httpStatus: ex?.status ?? null,
    error: errorOf(a.error),
    seedTransmitted: payload["seed"] === SEED,
    evidence: resp
      ? {
          reasoningFieldPresent: resp.reasoningFieldPresent,
          reasoningLength: resp.reasoningLength,
          thinkTagInContent: resp.thinkTagInContent,
          reasoningTokensReported: reasoningTokens === undefined ? null : Number(reasoningTokens),
          mastraReasoningSeparate: a.result?.reasoningSeparate ?? null,
          finishReason: resp.finishReason,
          usage: resp.usage,
        }
      : null,
    reasoningVerdict,
    payload,
  };

  // Chamada B: limite de saída.
  const b = await call(model, INPUT_B, LIMIT_B, reasoning.providerOptions);
  const exB = modelCall(b.exchanges);
  const payloadB = exB?.payload ?? {};
  const limitKey = ["max_completion_tokens", "max_tokens", "max_output_tokens"].find((k) => k in payloadB) ?? null;
  const usageB = (exB?.response?.usage ?? {}) as Record<string, unknown>;
  const completionTokens = typeof usageB["completion_tokens"] === "number" ? (usageB["completion_tokens"] as number) : null;
  const finishB = exB?.response?.finishReason ?? null;
  let limitVerdict: string;
  if (b.error !== undefined || exB?.status === null || (exB?.status ?? 500) >= 400) limitVerdict = "REJECTED";
  else if (finishB === "length") limitVerdict = "LIMIT_ENFORCED";
  else if (completionTokens !== null && completionTokens > LIMIT_B) limitVerdict = "LIMIT_NOT_ENFORCED";
  else limitVerdict = "UNKNOWN";

  const callB = {
    input: INPUT_B,
    limit: LIMIT_B,
    limitParamTransmitted: limitKey === null ? null : { key: limitKey, value: payloadB[limitKey] },
    httpStatus: exB?.status ?? null,
    error: errorOf(b.error),
    finishReason: finishB,
    completionTokensReported: completionTokens,
    usage: exB?.response?.usage ?? null,
    stoppedByLimit: finishB === "length",
    limitVerdict,
    payload: payloadB,
  };

  return {
    type: "probe",
    model: label,
    provider,
    at: new Date().toISOString(),
    note: "Sondagem fora dos casos C1–C6 e do denominador de 18. Seed transmitido não prova determinismo.",
    callA,
    callB,
    retryAfterSeconds: ex?.retryAfterSeconds ?? exB?.retryAfterSeconds ?? null,
  };
}

// Evidência de raciocínio numa troca (só presença, tamanho e tokens; nunca o conteúdo).
function evidenceOf(ex: Exchange | undefined, reasoningSeparate: boolean | undefined) {
  const resp = ex?.response;
  if (resp === null || resp === undefined) return null;
  const usage = (resp.usage ?? {}) as Record<string, unknown>;
  const reasoningTokens = /"reasoning_tokens":\s*(\d+)/.exec(JSON.stringify(usage))?.[1];
  return {
    reasoningFieldPresent: resp.reasoningFieldPresent,
    reasoningLength: resp.reasoningLength,
    thinkTagInContent: resp.thinkTagInContent,
    reasoningTokensReported: reasoningTokens === undefined ? null : Number(reasoningTokens),
    mastraReasoningSeparate: reasoningSeparate ?? null,
    completionTokens: typeof usage["completion_tokens"] === "number" ? (usage["completion_tokens"] as number) : null,
    contentLength: resp.contentLength,
    finishReason: resp.finishReason,
  };
}

// /api/show do Ollama: só capacidades e detalhes do modelo (sem template, licença nem parâmetros).
async function ollamaShow(model: string) {
  const base = (process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434/v1").replace(/\/v1\/?$/, "");
  const response = await fetch(`${base}/api/show`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model }) });
  const json = (await response.json()) as Record<string, unknown>;
  const info = (json["model_info"] ?? {}) as Record<string, unknown>;
  const contextKey = Object.keys(info).find((k) => k.endsWith(".context_length"));
  return {
    httpStatus: response.status,
    capabilities: Array.isArray(json["capabilities"]) ? (json["capabilities"] as string[]) : null,
    details: json["details"] ?? null,
    contextLength: contextKey === undefined ? null : info[contextKey],
  };
}

function latestCallA(slug: string): { file: string; callA: { reasoningVerdict: string; payload: Record<string, unknown>; evidence: { usage?: unknown; reasoningFieldPresent?: boolean; reasoningLength?: number } | null } } | null {
  const dir = new URL(`results/probes/${slug}/`, ROOT);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.includes("-control")).sort();
  const file = files.at(-1);
  if (file === undefined) return null;
  return { file, callA: (JSON.parse(readFileSync(new URL(file, dir), "utf8")) as { callA: never }).callA };
}

// Chamada de controle: igual à chamada A (entrada, seed, limite de 256), sem parâmetro de raciocínio.
// Se o /api/show não declarar a capacidade "thinking", nada é gerado: o controle de raciocínio
// não se aplica ao modelo (NOT_APPLICABLE).
async function probeControl(label: string, model: MastraModelConfig, slug: string) {
  const show = await ollamaShow(label.replace(/^ollama /, ""));
  const reference = latestCallA(slug);
  if (show.httpStatus === 200 && show.capabilities !== null && !show.capabilities.includes("thinking")) {
    return {
      type: "probe-control" as const,
      model: label,
      at: new Date().toISOString(),
      note: "Só /api/show, sem geração de texto: o modelo não declara a capacidade thinking. Fora dos casos C1–C6.",
      apiShow: show,
      control: null,
      reference: referenceSummary(reference),
      comparison: "NOT_APPLICABLE",
      retryAfterSeconds: null,
    };
  }
  const control = await call(model, INPUT_A, LIMIT_A, {});
  const ex = modelCall(control.exchanges);
  const payload = ex?.payload ?? {};
  const evidence = evidenceOf(ex, control.result?.reasoningSeparate);
  const controlReasons = evidence !== null && (evidence.reasoningFieldPresent || evidence.thinkTagInContent || evidence.mastraReasoningSeparate === true);
  const aVerdict = reference?.callA.reasoningVerdict ?? null;
  let comparison: string;
  if (control.error !== undefined || evidence === null || reference === null) comparison = "UNKNOWN";
  else if (controlReasons && aVerdict === "NO_REASONING_OBSERVED") comparison = "EFFECT_DEMONSTRATED";
  else if (!controlReasons && aVerdict === "NO_REASONING_OBSERVED") comparison = "EFFECT_NOT_DEMONSTRATED";
  else if (aVerdict === "REASONING_PRESENT") comparison = "PARAM_INEFFECTIVE";
  else comparison = "UNKNOWN";
  return {
    type: "probe-control" as const,
    model: label,
    at: new Date().toISOString(),
    note: "Chamada de controle fora dos casos C1–C6: igual à chamada A, sem reasoning_effort. Conteúdo de raciocínio nunca gravado.",
    apiShow: show,
    control: {
      input: INPUT_A,
      httpStatus: ex?.status ?? null,
      error: errorOf(control.error),
      reasoningParamInPayload: "reasoning_effort" in payload,
      seedTransmitted: payload["seed"] === SEED,
      evidence,
      reasoningObserved: controlReasons,
      payload,
    },
    reference: referenceSummary(reference),
    comparison,
    retryAfterSeconds: ex?.retryAfterSeconds ?? null,
  };
}

// Resumo da chamada A de referência (com o parâmetro de raciocínio) para a comparação.
function referenceSummary(reference: ReturnType<typeof latestCallA>) {
  if (reference === null) return null;
  const usage = (reference.callA.evidence?.usage ?? {}) as Record<string, unknown>;
  return {
    file: reference.file,
    reasoningVerdict: reference.callA.reasoningVerdict,
    reasoningEffortInPayload: reference.callA.payload["reasoning_effort"] ?? null,
    reasoningFieldPresent: reference.callA.evidence?.reasoningFieldPresent ?? null,
    completionTokens: typeof usage["completion_tokens"] === "number" ? (usage["completion_tokens"] as number) : null,
  };
}

function controlMarkdown(r: Awaited<ReturnType<typeof probeControl>>): string {
  const c = r.control;
  const e = c?.evidence ?? null;
  const controlSection =
    c === null
      ? ["- Não executada: o /api/show não declara a capacidade `thinking`, então não há raciocínio a desligar."]
      : [
          `- reasoning_effort no payload: ${c.reasoningParamInPayload ? "sim" : "não"}; seed transmitido: ${c.seedTransmitted ? "sim" : "não"}; HTTP ${c.httpStatus ?? "—"}${c.error ? `; erro ${c.error.code}: ${c.error.message}` : ""}`,
          `- Evidência: ${e ? `campo de raciocínio ${e.reasoningFieldPresent ? `presente (${e.reasoningLength} caracteres; conteúdo descartado)` : "ausente"}; marcador no texto: ${e.thinkTagInContent ? "sim" : "não"}; reasoning_tokens informados: ${e.reasoningTokensReported ?? "—"}; tokens de saída: ${e.completionTokens ?? "—"}; finish_reason: ${e.finishReason ?? "—"}` : "—"}`,
          `- Raciocínio observado: ${c.reasoningObserved ? "sim" : "não"}`,
        ];
  return [
    `# Chamada de controle: ${r.model}`,
    "",
    `${r.at}. ${r.note}`,
    "",
    "## /api/show",
    "",
    `- HTTP ${r.apiShow.httpStatus}; capacidades: ${r.apiShow.capabilities ? r.apiShow.capabilities.map((x) => `\`${x}\``).join(", ") : "—"}; contexto do modelo: ${r.apiShow.contextLength ?? "—"}`,
    "",
    "## Controle (sem reasoning_effort)",
    "",
    ...controlSection,
    "",
    "## Chamada A de referência (com reasoning_effort)",
    "",
    r.reference
      ? `- \`${r.reference.file}\`: reasoning_effort ${JSON.stringify(r.reference.reasoningEffortInPayload)}; resultado ${r.reference.reasoningVerdict}; campo de raciocínio ${r.reference.reasoningFieldPresent ? "presente" : "ausente"}; tokens de saída: ${r.reference.completionTokens ?? "—"}`
      : "- nenhuma chamada A encontrada",
    "",
    `**Comparação: ${r.comparison}**`,
    "",
    ...(c === null ? [] : ["## Payload do controle (sem cabeçalhos; mensagens omitidas)", "", "```json", JSON.stringify(c.payload, null, 2), "```", ""]),
    `Retry-After: ${r.retryAfterSeconds ?? "nenhum"}.`,
    "",
  ].join("\n");
}

function markdown(r: Awaited<ReturnType<typeof probe>>): string {
  const a = r.callA;
  const b = r.callB;
  return [
    `# Sondagem: ${r.model}`,
    "",
    `${r.at}. ${r.note}`,
    "",
    "## Chamada A: raciocínio e seed",
    "",
    `- Parâmetro de raciocínio: \`${a.reasoningParam.key}: ${JSON.stringify(a.reasoningParam.value)}\` (providerOptions \`${JSON.stringify(a.reasoningParam.providerOptions)}\`)`,
    `- Transmitido no payload: ${a.reasoningTransmitted ? "sim" : "não"}; aceito (HTTP ${a.httpStatus ?? "—"}): ${a.accepted ? "sim" : "não"}${a.error ? `; erro ${a.error.code}: ${a.error.message}` : ""}`,
    `- Evidência na resposta: ${a.evidence ? `campo de raciocínio ${a.evidence.reasoningFieldPresent ? `presente (${a.evidence.reasoningLength} caracteres; conteúdo descartado)` : "ausente"}; marcador no texto: ${a.evidence.thinkTagInContent ? "sim" : "não"}; reasoning_tokens informados: ${a.evidence.reasoningTokensReported ?? "—"}; finish_reason: ${a.evidence.finishReason ?? "—"}` : "—"}`,
    `- **Resultado do raciocínio: ${a.reasoningVerdict}**`,
    `- Seed ${SEED} transmitido: ${a.seedTransmitted ? "sim" : "não"} (transmitido não prova determinismo)`,
    "",
    "## Chamada B: limite de saída",
    "",
    `- Limite: ${b.limit} tokens; parâmetro no payload: ${b.limitParamTransmitted ? `\`${b.limitParamTransmitted.key}: ${JSON.stringify(b.limitParamTransmitted.value)}\`` : "não encontrado"}`,
    `- HTTP ${b.httpStatus ?? "—"}${b.error ? `; erro ${b.error.code}: ${b.error.message}` : ""}; finish_reason: ${b.finishReason ?? "—"}; tokens de saída informados: ${b.completionTokensReported ?? "—"}`,
    `- **Resultado do limite: ${b.limitVerdict}**`,
    "",
    "## Payload enviado (sem cabeçalhos; mensagens omitidas)",
    "",
    "```json",
    JSON.stringify({ chamadaA: a.payload, chamadaB: b.payload }, null, 2),
    "```",
    "",
    `Retry-After: ${r.retryAfterSeconds ?? "nenhum"}.`,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const index = process.argv.indexOf("--model");
  const only = index >= 0 ? process.argv[index + 1] : undefined;
  if (process.argv.includes("--control")) {
    const m = spikeModels().find((x) => x.label === only);
    if (m === undefined || !m.label.startsWith("ollama ")) {
      console.error('Uso: node --env-file=.env src/probe.ts --control --model "<rótulo ollama>"');
      process.exitCode = 1;
      return;
    }
    const envProblem = ollamaEnvProblem();
    if (envProblem !== null) {
      console.error(`${envProblem} Sondagem não executada.`);
      process.exitCode = 1;
      return;
    }
    const slug = m.label.replace(/[^a-zA-Z0-9.]+/g, "-");
    const result = await probeControl(m.label, m.config, slug);
    const stamp = result.at.replace(/[:.]/g, "-");
    const dir = new URL(`results/probes/${slug}/`, ROOT);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL(`${stamp}-control.json`, dir), JSON.stringify(result, null, 2) + "\n");
    writeFileSync(new URL(`${stamp}-control.md`, dir), controlMarkdown(result));
    console.log(sanitize(`${m.label}: capacidades ${JSON.stringify(result.apiShow.capabilities)}; controle com raciocínio ${result.control?.reasoningObserved ?? "não executado"}; comparação ${result.comparison} → results/probes/${slug}/${stamp}-control.md`));
    return;
  }
  for (const m of spikeModels().filter((x) => only === undefined || x.label === only)) {
    const provider: ProbeProvider = m.label.startsWith("groq ") ? "groq" : "ollama";
    const envProblem = provider === "ollama" ? ollamaEnvProblem() : null;
    if (envProblem !== null) {
      console.error(`${m.label}: ${envProblem} Sondagem não executada.`);
      process.exitCode = 1;
      continue;
    }
    const result = await probe(m.label, provider, m.config);
    const slug = m.label.replace(/[^a-zA-Z0-9.]+/g, "-");
    const stamp = result.at.replace(/[:.]/g, "-");
    const dir = new URL(`results/probes/${slug}/`, ROOT);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL(`${stamp}.json`, dir), JSON.stringify(result, null, 2) + "\n");
    writeFileSync(new URL(`${stamp}.md`, dir), markdown(result));
    console.log(sanitize(`${m.label}: raciocínio ${result.callA.reasoningVerdict}; seed transmitido ${result.callA.seedTransmitted}; limite ${result.callB.limitVerdict} → results/probes/${slug}/${stamp}.md`));
  }
}

if (import.meta.main) {
  await main();
}
