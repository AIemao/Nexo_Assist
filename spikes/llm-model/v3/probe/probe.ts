// Sondagens Q1 e Q2 da V3 (v3/CRITERIA.md, "Sondagens Q1 e Q2"). FORA do manifesto; diagnósticas:
// não pontuam e não aprovam nada. Rodam durante a implementação, antes do congelamento.
//
//   node --env-file=.env v3/probe/probe.ts --model "ollama qwen3:4b-instruct"
//   node --env-file=.env v3/probe/probe.ts --model "ollama qwen3:8b"
// Testes próprios (fora da suíte oficial v3/src/*.test.ts): node --test v3/probe/probe.test.ts
//
// - Q1: o Ollama aceita o response_format da fase 2 e devolve JSON puro no content? Fase 2 isolada
//   (segundo Agent sem tools, maxSteps 1, structuredOutput com errorStrategy "warn"), só com a
//   mensagem do funcionário.
// - Q2: o Ollama aceita mensagens assistant com tool_calls e mensagens tool numa requisição sem tools
//   declaradas? Q2a: a fase 2 com uma transcrição fabricada (determinística: um tool call e o
//   resultado da tool falsa da V1). Q2b: o turno completo da V3 (runAttempt), com entradas que
//   convidam a tools.
// - Entradas próprias, fixas e idênticas entre os modelos; nenhuma dos seis casos. Uma execução por
//   entrada; erro numa entrada é registrado e não impede as demais.
// - Persistência: só metadados (status HTTP, booleanos, contagens, nomes de tool, códigos). Nenhum
//   texto do modelo, argumento, resultado de tool ou raciocínio. Antes de gravar, o conteúdo é
//   conferido contra padrões proibidos.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

import { Agent } from "@mastra/core/agent";
import type { MessageListInput } from "@mastra/core/agent/message-list";
import type { MastraModelConfig } from "@mastra/core/llm";
import { noopLogger } from "@mastra/core/logger";

import { casesFileSchema, type CasesFile } from "../../src/cases-schema.ts";
import { spikeModels } from "../../src/models.ts";
import { SYSTEM_PROMPT } from "../../src/prompt.ts";
import { MODEL_SETTINGS, REASONING_CONTROL, classifyError, ollamaEnvProblem, sanitize, withSanitizedConsole, type ProviderOptionsJson } from "../../src/run.ts";
import { interpretationSchema } from "../../src/schema.ts";
import { createFakeTools } from "../../src/tools.ts";
import { allowedHostsOf, ollamaDigest } from "../../v2/src/run.ts";
import { readInterpretation } from "../src/phase2.ts";
import { PHASE2_MAX_STEPS, runAttempt } from "../src/run.ts";
import { checkInvariantsV3 } from "../src/score.ts";

type Case = CasesFile["cases"][number];
type Loose = Record<string, unknown>;
const asLoose = (value: unknown): Loose => (typeof value === "object" && value !== null ? (value as Loose) : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const SPIKE_ROOT = new URL("../../", import.meta.url);
const V3_ROOT = new URL("../", import.meta.url);

// Entradas próprias: fixas, idênticas entre os modelos, fora dos seis casos.
export const Q1_INPUTS = [
  { id: "Q1-1", purpose: "problema com impacto (abrir chamado)", input: "Meu monitor externo não liga desde hoje cedo e preciso dele para trabalhar." },
  { id: "Q1-2", purpose: "pedido de software", input: "Quero saber se dá para instalar o Figma no meu notebook." },
  { id: "Q1-3", purpose: "encerramento", input: "Obrigado, era só isso!" },
] as const;

export const Q2A_INPUTS = [
  { id: "Q2a-1", purpose: "transcrição com listMyTickets", input: "Quais pedidos meus ainda estão em aberto?", tool: "listMyTickets", args: {} },
  { id: "Q2a-2", purpose: "transcrição com searchArticles", input: "Como eu configuro a VPN no celular?", tool: "searchArticles", args: { query: "configurar vpn celular" } },
] as const;

export const Q2B_INPUTS = [
  { id: "Q2b-1", purpose: "turno completo que convida a listMyTickets", input: "Pode me mostrar os chamados que eu já abri?" },
  { id: "Q2b-2", purpose: "turno completo que convida a searchArticles", input: "Como faço para trocar a senha do e-mail corporativo?" },
] as const;

// Padrões que nunca podem ir para disco (CRITERIA da V1, da V2 e da V3, "Registros").
export const FORBIDDEN = /authorization|bearer|gsk_|x-ratelimit/i;

// Métricas do texto da fase 2, sem gravar o texto.
export function outputMetrics(text: string, finishReason: string | null) {
  const official = readInterpretation(text, finishReason);
  return {
    chars: text.length,
    empty: text.trim() === "",
    pureJson: official.parse === "OK",
    fenced: /^\s*```/.test(text),
    proseAroundJson: official.parse === "INVALID_JSON" && text.includes("{") && !/^\s*```/.test(text),
    parse: official.parse,
    zodValid: official.parse === "OK" && interpretationSchema.safeParse(official.value).success,
  };
}

interface RequestView {
  status: number | null;
  tools: boolean;
  toolChoice: boolean;
  responseFormat: boolean;
  assistantWithToolCalls: number;
  toolMessages: number;
}

// Observa as requisições (só chaves e contagens) e os status HTTP, por fora da chamada.
async function observe<T>(fn: () => Promise<T>): Promise<{ result: T; requests: RequestView[] }> {
  const below = globalThis.fetch;
  const requests: RequestView[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    let view: RequestView = { status: null, tools: false, toolChoice: false, responseFormat: false, assistantWithToolCalls: 0, toolMessages: 0 };
    try {
      const body = asLoose(JSON.parse(String(init?.body ?? "{}")));
      const messages = asArray(body["messages"]).map(asLoose);
      view = {
        status: null,
        tools: body["tools"] !== undefined,
        toolChoice: body["tool_choice"] !== undefined,
        responseFormat: body["response_format"] !== undefined,
        assistantWithToolCalls: messages.filter((m) => m["role"] === "assistant" && asArray(m["tool_calls"]).length > 0).length,
        toolMessages: messages.filter((m) => m["role"] === "tool").length,
      };
    } catch {
      // corpo ilegível: só o status fica registrado
    }
    requests.push(view);
    const response = await below(input, init);
    view.status = response.status;
    return response;
  }) as typeof fetch;
  try {
    return { result: await fn(), requests };
  } finally {
    globalThis.fetch = below;
  }
}

export interface ProbeOptions {
  model: MastraModelConfig;
  modelLabel: string;
  allowedHosts: readonly string[];
  providerOptions?: ProviderOptionsJson;
  templateCase: Case;
}

// Fase 2 isolada (Q1 e Q2a): o mesmo Agent e as mesmas opções da fase 2 da V3.
async function phase2Call(options: ProbeOptions, messages: unknown[]) {
  const agent = new Agent({ id: "spike-adr009-v3-sonda", name: "spike-adr009-v3-sonda", instructions: SYSTEM_PROMPT, model: options.model });
  agent.__setLogger(noopLogger);
  const { result, requests } = await observe(() =>
    withSanitizedConsole(async () => {
      try {
        return { output: asLoose(await agent.generate(messages as MessageListInput, { structuredOutput: { schema: interpretationSchema, errorStrategy: "warn" }, modelSettings: { ...MODEL_SETTINGS }, maxSteps: PHASE2_MAX_STEPS, providerOptions: options.providerOptions } as never)), thrown: undefined };
      } catch (error) {
        return { output: {} as Loose, thrown: error as unknown };
      }
    }),
  );
  const failure = result.thrown ?? (result.output["error"] ?? undefined);
  const error = failure === undefined || failure === null ? null : classifyError(failure);
  const text = typeof result.output["text"] === "string" ? result.output["text"] : "";
  const finishReason = typeof result.output["finishReason"] === "string" ? result.output["finishReason"] : null;
  const steps = asArray(result.output["steps"]).map(asLoose);
  return {
    httpStatuses: requests.map((r) => r.status),
    accepted: requests.some((r) => r.status !== null && r.status >= 200 && r.status < 300),
    requestShape: requests[0] ?? null,
    error: error === null ? null : { code: error.code, status: error.status, message: error.message },
    finishReason,
    output: outputMetrics(text, finishReason),
    mastraObjectPresent: result.output["object"] !== undefined && result.output["object"] !== null,
    toolCallsEmitted: steps.flatMap((s) => asArray(s["toolCalls"]).map((c) => String(asLoose(asLoose(c)["payload"] ?? c)["toolName"] ?? ""))),
    inputTokens: steps.map((s) => asLoose(s["usage"])["inputTokens"] ?? null),
  };
}

export type ProbeEntry = Loose & { id: string; question: "Q1" | "Q2a" | "Q2b" };

export async function runProbes(options: ProbeOptions): Promise<ProbeEntry[]> {
  const entries: ProbeEntry[] = [];
  for (const q of Q1_INPUTS) {
    try {
      entries.push({ id: q.id, question: "Q1", purpose: q.purpose, ...(await phase2Call(options, [{ role: "user", content: q.input }])) });
    } catch (error) {
      entries.push({ id: q.id, question: "Q1", purpose: q.purpose, probeError: sanitize(String(error)) });
    }
  }
  for (const q of Q2A_INPUTS) {
    try {
      const { tools } = createFakeTools();
      const execute = (tools[q.tool] as unknown as { execute: (input: unknown, context: unknown) => Promise<unknown> }).execute;
      const result = await execute(q.args, {});
      const transcript = [
        { role: "user", content: q.input },
        { role: "assistant", content: [{ type: "tool-call", toolCallId: `${q.id}-call`, toolName: q.tool, input: q.args }] },
        { role: "tool", content: [{ type: "tool-result", toolCallId: `${q.id}-call`, toolName: q.tool, output: { type: "json", value: result } }] },
      ];
      entries.push({ id: q.id, question: "Q2a", purpose: q.purpose, ...(await phase2Call(options, transcript)) });
    } catch (error) {
      entries.push({ id: q.id, question: "Q2a", purpose: q.purpose, probeError: sanitize(String(error)) });
    }
  }
  for (const q of Q2B_INPUTS) {
    try {
      const testCase: Case = { ...options.templateCase, id: q.id, history: [], input: q.input };
      const { record, error } = await runAttempt({ model: options.model, modelLabel: options.modelLabel, provider: "ollama", testCase, repetition: 1, allowedHosts: options.allowedHosts, providerOptions: options.providerOptions }, 1);
      const p2 = record.phase2;
      entries.push({
        id: q.id,
        question: "Q2b",
        purpose: q.purpose,
        status: record.status,
        error: error === null ? null : { code: error.code, status: error.status },
        phase1: { toolCalls: record.phase1.emitted.map((e) => e.toolName), finishReasons: record.phase1.calls.map((c) => c.finishReason), transcript: record.phase1.transcript },
        phase2: p2 === null ? null : { status: p2.status, error: p2.execError?.code ?? null, finishReason: p2.finishReason, parse: p2.parse, zodValid: p2.zodValid, mastraObjectPresent: p2.mastraObjectPresent, request: p2.request, toolCallsEmitted: p2.toolCalls.names },
        exercisedQ2: (p2?.request.requests ?? 0) > 0 && record.phase1.transcript.toolMessages > 0,
        fidelity: { violations: record.fidelity.violations.length, diagnostics: record.fidelity.diagnostics.length },
        invariants: checkInvariantsV3(record).map((v) => v.invariant),
        instrumentFailures: record.instrumentFailures.map((f) => `${f.layer}/${f.phase ?? "—"}`),
        contextCheck: record.contextCheck.status,
        turnLatencyMs: record.turnLatencyMs,
      });
    } catch (error) {
      entries.push({ id: q.id, question: "Q2b", purpose: q.purpose, probeError: sanitize(String(error)) });
    }
  }
  return entries;
}

// SHA-256 do código da V3 usado na sondagem (o manifesto ainda não existe).
function v3CodeHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(new URL("src/", V3_ROOT)).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts")).sort()) {
    out[`v3/src/${f}`] = createHash("sha256").update(readFileSync(new URL(`src/${f}`, V3_ROOT))).digest("hex");
  }
  return out;
}

const yn = (b: unknown) => (b === true ? "sim" : b === false ? "não" : "—");

export function probeMarkdown(header: Loose, entries: ProbeEntry[]): string {
  const lines = [`# Sondagem V3 (Q1, Q2): ${String(header["model"])}`, "", `${String(header["startedAt"])}. Fora dos seis casos; diagnóstica, sem pontuação.`, "", `- Digest: ${String(header["digest"] ?? "não encontrado")}`, `- Controle de raciocínio: ${String(header["reasoningControl"])}`, `- Manifesto da V3: não congelado (SHA-256 do código no .jsonl)`, ""];
  lines.push("## Q1 e Q2a (fase 2 isolada)", "", "| Entrada | HTTP | Aceita | Sem tools / tool_choice | response_format | Mensagens tool | Erro | finishReason | JSON puro | Cerca | Prosa | Zod | `object` do Mastra | Tool calls |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const e of entries.filter((x) => x.question !== "Q2b")) {
    if ("probeError" in e) {
      lines.push(`| ${e.id} | — | — | — | — | — | erro da sondagem: ${String(e["probeError"])} | — | — | — | — | — | — | — |`);
      continue;
    }
    const shape = asLoose(e["requestShape"]);
    const out = asLoose(e["output"]);
    const err = asLoose(e["error"]);
    lines.push(
      `| ${e.id} | ${asArray(e["httpStatuses"]).join(", ")} | ${yn(e["accepted"])} | ${yn(!shape["tools"] && !shape["toolChoice"])} | ${yn(shape["responseFormat"])} | ${String(shape["toolMessages"] ?? "—")} | ${e["error"] === null ? "—" : `${String(err["code"])} (${String(err["status"] ?? "—")})`} | ${String(e["finishReason"] ?? "—")} | ${yn(out["pureJson"])} | ${yn(out["fenced"])} | ${yn(out["proseAroundJson"])} | ${yn(out["zodValid"])} | ${yn(e["mastraObjectPresent"])} | ${asArray(e["toolCallsEmitted"]).join(", ") || "—"} |`,
    );
  }
  lines.push("", "## Q2b (turno completo da V3)", "", "| Entrada | Situação | Tools da fase 1 | Q2 exercitada | Fase 2 | Leitura | Zod | Invariantes | Falhas do instrumento | Truncamento | Latência (ms) |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const e of entries.filter((x) => x.question === "Q2b")) {
    if ("probeError" in e) {
      lines.push(`| ${e.id} | erro da sondagem: ${String(e["probeError"])} | — | — | — | — | — | — | — | — | — |`);
      continue;
    }
    const p1 = asLoose(e["phase1"]);
    const p2 = asLoose(e["phase2"]);
    lines.push(
      `| ${e.id} | ${String(e["status"])} | ${asArray(p1["toolCalls"]).join(", ") || "nenhuma"} | ${yn(e["exercisedQ2"])} | ${e["phase2"] === null ? "não executada" : `${String(p2["status"])}${p2["error"] ? ` (${String(p2["error"])})` : ""}`} | ${String(p2["parse"] ?? "—")} | ${yn(p2["zodValid"])} | ${asArray(e["invariants"]).join(", ") || "OK"} | ${asArray(e["instrumentFailures"]).join(", ") || "nenhuma"} | ${String(e["contextCheck"])} | ${String(e["turnLatencyMs"])} |`,
    );
  }
  lines.push("", "Leitura: Q1 responde se o content vem como JSON puro com o response_format; Q2 responde se o Ollama aceita (HTTP 2xx) a forma da fase 2 com mensagens tool sem tools declaradas. Se a Q2 for negativa, o desenho é revisto antes de congelar (v3/CRITERIA.md).", "");
  return lines.join("\n");
}

export function writeProbeFiles(header: Loose, entries: ProbeEntry[], dir = new URL("results/probes/", V3_ROOT)) {
  const jsonl = [header, ...entries].map((l) => JSON.stringify(l)).join("\n") + "\n";
  const markdown = probeMarkdown(header, entries);
  if (FORBIDDEN.test(jsonl) || FORBIDDEN.test(markdown)) throw new Error("conteúdo proibido no registro da sondagem; nada foi gravado");
  mkdirSync(dir, { recursive: true });
  const slug = String(header["model"]).replace(/[^a-zA-Z0-9.]+/g, "-");
  const stamp = String(header["startedAt"]).replace(/[:.]/g, "-");
  const files = { jsonl: new URL(`${slug}-${stamp}.jsonl`, dir), markdown: new URL(`${slug}-${stamp}.md`, dir) };
  writeFileSync(files.jsonl, jsonl);
  writeFileSync(files.markdown, markdown);
  return files;
}

async function main(): Promise<void> {
  const index = process.argv.indexOf("--model");
  const label = index >= 0 ? process.argv[index + 1] : undefined;
  const models = spikeModels().filter((m) => m.label.startsWith("ollama "));
  const chosen = models.find((m) => m.label === label);
  if (chosen === undefined) {
    console.error(`Uso: node --env-file=.env v3/probe/probe.ts --model "<rótulo>"\nRótulos (Groq fora da V3): ${models.map((m) => `"${m.label}"`).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const envProblem = ollamaEnvProblem();
  if (envProblem !== null) {
    console.error(`${envProblem} Sondagem recusada.`);
    process.exitCode = 1;
    return;
  }
  const cases = casesFileSchema.parse(JSON.parse(readFileSync(new URL("cases.json", SPIKE_ROOT), "utf8"))).cases;
  const reasoning = REASONING_CONTROL.ollama;
  const url = asLoose(chosen.config)["url"];
  const startedAt = new Date().toISOString();
  const digest = typeof url === "string" ? await ollamaDigest(url, chosen.label.replace(/^ollama /, "")).catch(() => null) : null;
  const entries = await runProbes({ model: chosen.config, modelLabel: chosen.label, allowedHosts: allowedHostsOf("ollama", chosen.config), providerOptions: reasoning.providerOptions, templateCase: cases[0] as Case });
  const header = {
    type: "probe-run",
    experiment: "v3",
    model: chosen.label,
    startedAt,
    digest,
    reasoningControl: `${reasoning.note}${reasoning.providerOptions ? `; providerOptions ${JSON.stringify(reasoning.providerOptions)}` : ""}`,
    manifest: "não congelado",
    v3Code: v3CodeHashes(),
    inputs: { Q1: Q1_INPUTS, Q2a: Q2A_INPUTS, Q2b: Q2B_INPUTS },
  };
  const files = writeProbeFiles(header, entries);
  console.log(`Sondagem gravada: ${files.jsonl.pathname} e ${files.markdown.pathname}`);
  for (const e of entries) {
    const out = asLoose(e["output"]);
    console.log(`- ${e.id}: ${"probeError" in e ? `erro da sondagem: ${String(e["probeError"])}` : e.question === "Q2b" ? `${String(e["status"])}; Q2 exercitada ${yn(e["exercisedQ2"])}; invariantes ${asArray(e["invariants"]).join(", ") || "OK"}` : `HTTP ${asArray(e["httpStatuses"]).join(", ")}; JSON puro ${yn(out["pureJson"])}; Zod ${yn(out["zodValid"])}`}`);
  }
}

if (import.meta.main) {
  await main();
}
