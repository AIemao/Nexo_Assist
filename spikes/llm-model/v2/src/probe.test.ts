// Testes da sondagem P1–P4 (v2/src/probe.ts), sem modelo real: caminhos reais do Ollama (router) e
// do Groq com respostas HTTP FABRICADAS (o fetch global é substituído), como no provider-path.test.ts.
// As métricas são conferidas contra o que foi observado (corpo enviado, resposta, registro do turno).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { spikeModels } from "../../src/models.ts";
import { REASONING_CONTROL } from "../../src/run.ts";
import {
  FORBIDDEN,
  PROBE_INPUTS,
  attemptMetrics,
  endedWithTextOnly,
  p1Of,
  p3Ids,
  p4PerStep,
  runProbes,
  serialize,
  stripArgs,
  withRequestCapture,
  writeProbeFiles,
  type ProbeEntryRecord,
  type ProbeHeader,
  type ProbeOptions,
} from "./probe.ts";
import type { EmittedCall } from "./record.ts";
import { allowedHostsOf, providerOf } from "./run.ts";
import { VALID, cases } from "./test-helpers.ts";

type ToolCallSpec = [id: string | null, name: string, args: unknown];

const completion = (toolCalls: ToolCallSpec[], extra: Record<string, unknown> = {}) => ({
  id: "chatcmpl-fabricado",
  object: "chat.completion",
  created: 1_700_000_000,
  model: "fabricado",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: toolCalls.map(([id, name, args]) => ({ ...(id === null ? {} : { id }), type: "function", function: { name, arguments: JSON.stringify(args) } })),
        ...extra,
      },
      finish_reason: "tool_calls",
    },
  ],
  usage: { prompt_tokens: 900, completion_tokens: 20, total_tokens: 920 },
});
const textCompletion = (text: string, extra: Record<string, unknown> = {}) => ({ ...completion([]), choices: [{ index: 0, message: { role: "assistant", content: text, ...extra }, finish_reason: "stop" }] });

interface Scripted {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}

// fetch global fabricado: devolve o roteiro em ordem. A resposta traz `authorization` (que a sondagem
// nunca pode gravar) e, só quando pedido, um cabeçalho de limite de taxa. Esse cabeçalho, quando
// presente, tem restante ALTO: o Mastra 1.81.0 espera 10 s ao fim de cada passo quando
// x-ratelimit-remaining-tokens está entre 1 e 1999 (agent-DtdQ6un6.js:52747; mastra-behavior.test.ts).
async function withFabricatedHttp<T>(script: (Scripted | unknown)[], fn: () => Promise<T>, opts: { rateLimitHeader?: boolean } = {}) {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const item = script[urls.length - 1] ?? textCompletion("FORA DO ROTEIRO");
    const scripted = typeof item === "object" && item !== null && "body" in item ? (item as Scripted) : { body: item };
    const headers: Record<string, string> = { "content-type": "application/json", authorization: "Bearer gsk_vazado", ...(scripted.headers ?? {}) };
    if (opts.rateLimitHeader === true) headers["x-ratelimit-remaining-tokens"] = "100000";
    return new Response(JSON.stringify(scripted.body), { status: scripted.status ?? 200, headers });
  }) as typeof fetch;
  try {
    return { result: await fn(), urls };
  } finally {
    globalThis.fetch = original;
  }
}

const previousKey = process.env["GROQ_API_KEY"];
process.env["GROQ_API_KEY"] = "chave-ficticia-de-teste";
const models = spikeModels();
if (previousKey === undefined) delete process.env["GROQ_API_KEY"];
else process.env["GROQ_API_KEY"] = previousKey;

function optionsFor(label: string, over: Partial<ProbeOptions> = {}): ProbeOptions {
  const chosen = models.find((m) => m.label === label);
  assert.ok(chosen, label);
  const provider = providerOf(label);
  return {
    model: chosen.config,
    modelLabel: label,
    provider,
    allowedHosts: allowedHostsOf(provider, chosen.config),
    providerOptions: REASONING_CONTROL[provider].providerOptions,
    templateCase: cases[0] as (typeof cases)[number],
    pauseMs: 0,
    ...over,
  };
}

const OLLAMA = "ollama qwen3:4b-instruct";
const GROQ = "groq openai/gpt-oss-120b";
const SUBMIT_C3 = VALID.C3;
const fail = (status: number, message: string, headers?: Record<string, string>): Scripted => ({ status, body: { error: { message } }, ...(headers ? { headers } : {}) });
const steps = (e: ProbeEntryRecord, attempt = 0) => e.attempts?.[attempt]?.p4.map((s) => `${s.step}:${s.total}:${s.business}:${s.submit}:${s.parallel}:${s.finishReason}`);
const callsOf = (e: ProbeEntryRecord, attempt = 0) => e.attempts?.[attempt]?.p2.calls.map((c) => `${c.step}:${c.toolName}`);

describe("sondagem pelo caminho real do Ollama (HTTP fabricado): as três entradas", () => {
  it("negócio + submissão; sem tool de negócio; duas tools no mesmo passo: P1–P4 e integridade observados", async () => {
    const { result: entries, urls } = await withFabricatedHttp(
      [
        completion([["L1", "listMyTickets", {}]]),
        completion([["S1", "submitInterpretation", SUBMIT_C3]]),
        textCompletion("Bom dia!"),
        completion([["A1", "searchArticles", { query: "senha email" }], ["L2", "listMyTickets", {}]]),
        completion([["S2", "submitInterpretation", SUBMIT_C3]]),
      ],
      () => runProbes(optionsFor(OLLAMA)),
    );
    assert.deepEqual(entries.map((e) => e.entry), PROBE_INPUTS.map((p) => p.id));
    assert.equal(urls.length, 5, "uma execução por entrada: 2 + 1 + 2 requisições, nenhuma repetição");
    assert.ok(urls.every((u) => new URL(u).host === "localhost:11434"), "só o endpoint do modelo");

    const [e1, e2, e3] = entries as [ProbeEntryRecord, ProbeEntryRecord, ProbeEntryRecord];
    // P1: observado no corpo e na resposta de cada requisição real; aceitação HTTP ≠ resultado do turno.
    assert.deepEqual(e1.p1.toolChoice, { status: "observed", values: ["auto"], observedBodies: 2, unobservedBodies: 0 });
    assert.ok(e1.p1.requests.every((r) => r.stream === false && r.responseFormatPresent === false && r.status === 200));
    assert.deepEqual(e1.p1.providerAccepted, { all: true, count2xx: 2, total: 2 });
    assert.equal(e1.p1.turnCompleted, true);
    // Uma tentativa; P2, P3 e P4 dentro dela.
    assert.equal(e1.attempts?.length, 1);
    assert.deepEqual(e1.attempts?.[0]?.p2.calls.map((c) => `${c.step}:${c.toolName}:${c.kind}:${c.validAtCapture}`), ["0:listMyTickets:business:true", "1:submitInterpretation:submit:true"]);
    assert.equal(e1.attempts?.[0]?.p2.submissionAccepted, true);
    assert.deepEqual(e1.attempts?.[0]?.p3, { calls: 2, present: 2, missing: 0, duplicated: 0, allPresentAndUnique: true });
    assert.deepEqual(e1.p3Provider, { calls: 2, withId: 2, missing: 0, duplicatedInSameResponse: 0 });
    assert.deepEqual(steps(e1), ["0:1:1:0:false:tool-calls", "1:1:0:1:false:tool-calls"]);
    assert.equal(e1.attempts?.[0]?.retrySteps, 0);
    assert.equal(e1.attempts?.[0]?.endedWithTextOnly, false);
    assert.deepEqual(e1.integrity, { violations: [], diagnostics: [] });
    assert.deepEqual(e1.effects, { externalRequests: 0, fakeToolExecutions: 1 });

    // Entrada sem tool: nenhuma chamada, sem submissão, terminou só com texto.
    assert.equal(e2.outcome, "completed");
    assert.deepEqual(callsOf(e2), []);
    assert.equal(e2.attempts?.[0]?.p2.submissionEmitted, false);
    assert.equal(e2.attempts?.[0]?.endedWithTextOnly, true);
    assert.deepEqual(steps(e2), ["0:0:0:0:false:stop"]);
    assert.deepEqual(e2.effects, { externalRequests: 0, fakeToolExecutions: 0 });

    // Duas tools de negócio no mesmo passo (P4 paralelas), executadas pelas tools falsas.
    assert.deepEqual(steps(e3), ["0:2:2:0:true:tool-calls", "1:1:0:1:false:tool-calls"]);
    assert.deepEqual(e3.effects, { externalRequests: 0, fakeToolExecutions: 2 });
  });
});

describe("tentativas anteriores (429 tratado pelo runTurn) nas métricas P2, P3 e P4", () => {
  it("tool de negócio na tentativa 1, depois 429; submissão na tentativa 2: as duas tentativas, sem misturar passos", async () => {
    const tpm = fail(429, "Rate limit reached: tokens per minute (TPM)", { "retry-after": "1" });
    const { result: entries, urls } = await withFabricatedHttp(
      // Tentativa 1: tool de negócio; depois 429 três vezes (duas repetições internas do Mastra).
      // Tentativa 2 (depois do Retry-After): submissão.
      [completion([["L1", "listMyTickets", {}]]), tpm, tpm, tpm, completion([["S2", "submitInterpretation", SUBMIT_C3]])],
      () => runProbes(optionsFor(OLLAMA, { inputs: [PROBE_INPUTS[0]] })),
    );
    assert.equal(urls.length, 5);
    const e = entries[0] as ProbeEntryRecord;
    assert.equal(e.outcome, "completed");
    assert.equal(e.attempts?.length, 2);
    const [a1, a2] = e.attempts as [NonNullable<ProbeEntryRecord["attempts"]>[number], NonNullable<ProbeEntryRecord["attempts"]>[number]];
    // Tentativa 1: a chamada emitida antes do 429 não se perde.
    assert.equal(a1.attempt, 1);
    assert.equal(a1.errorCode, "EXEC_RATE_LIMIT");
    assert.deepEqual(callsOf(e, 0), ["0:listMyTickets"]);
    assert.deepEqual(a1.p4.map((s) => `${s.step}:${s.finishReason}`), ["0:tool-calls", "1:retry", "2:retry", "3:error"]);
    assert.equal(a1.retrySteps, 2);
    assert.equal(a1.p2.submissionAccepted, false);
    assert.deepEqual(a1.p3, { calls: 1, present: 1, missing: 0, duplicated: 0, allPresentAndUnique: true });
    // Tentativa 2: começa de novo no passo 0, com a submissão.
    assert.equal(a2.attempt, 2);
    assert.equal(a2.errorCode, null);
    assert.deepEqual(callsOf(e, 1), ["0:submitInterpretation"]);
    assert.deepEqual(a2.p4.map((s) => `${s.step}:${s.finishReason}`), ["0:tool-calls"]);
    assert.equal(a2.p2.submissionAccepted, true);
    // P1: aceitação HTTP por requisição, separada do resultado do turno (concluído).
    assert.deepEqual(e.p1.httpStatuses, [200, 429, 429, 429, 200]);
    assert.deepEqual(e.p1.providerAccepted, { all: false, count2xx: 2, total: 5 });
    assert.equal(e.p1.turnCompleted, true);
    assert.deepEqual(e.rateLimits.map((r) => `${r.attempt}:${r.status}:${r.retryAfterSeconds}:${r.waitSeconds}`), ["1:429:1:1"]);
    assert.deepEqual(e.integrity?.violations, []);
    assert.deepEqual(e.effects, { externalRequests: 0, fakeToolExecutions: 1 }, "a execução da tentativa 1 conta");
    assert.ok(e.p1.requests.every((r) => r.modelEndpoint === true));
  });
});

describe("identificadores (P3) observados", () => {
  it("toolCallId duplicado no mesmo passo: P3 conta o duplicado (provider e instrumento)", async () => {
    const { result: entries } = await withFabricatedHttp(
      [completion([["X", "listMyTickets", {}], ["X", "searchArticles", { query: "senha" }]]), completion([["S1", "submitInterpretation", SUBMIT_C3]])],
      () => runProbes(optionsFor(OLLAMA, { inputs: [PROBE_INPUTS[2]] })),
    );
    const e = entries[0] as ProbeEntryRecord;
    assert.deepEqual(e.p3Provider, { calls: 3, withId: 3, missing: 0, duplicatedInSameResponse: 1 });
    assert.deepEqual(e.attempts?.[0]?.p3, { calls: 3, present: 3, missing: 0, duplicated: 1, allPresentAndUnique: false });
  });

  it("toolCallId ausente na resposta do provider: o P3 do provider vê a omissão; o do instrumento vê o id gerado pelo SDK", async () => {
    const { result: entries } = await withFabricatedHttp(
      [completion([[null, "listMyTickets", {}]]), completion([["S1", "submitInterpretation", SUBMIT_C3]])],
      () => runProbes(optionsFor(OLLAMA, { inputs: [PROBE_INPUTS[0]] })),
    );
    const e = entries[0] as ProbeEntryRecord;
    assert.deepEqual(e.p3Provider, { calls: 2, withId: 1, missing: 1, duplicatedInSameResponse: 0 }, "observado na resposta");
    assert.deepEqual(e.attempts?.[0]?.p3, { calls: 2, present: 2, missing: 0, duplicated: 0, allPresentAndUnique: true }, "o SDK compatível com OpenAI gera um id");
    assert.deepEqual(e.integrity, { violations: [], diagnostics: [] });
  });

  it("p3Ids sobre emissões fabricadas: ausentes (null e vazio) e duplicados", () => {
    const emit = (order: number, toolCallId: string | null): EmittedCall => ({ step: 0, order, toolCallId, toolName: "listMyTickets", rawArgs: {}, validAtCapture: true });
    assert.deepEqual(p3Ids({ emitted: [emit(0, null), emit(1, ""), emit(2, "A"), emit(3, "A"), emit(4, "B")] }), { calls: 5, present: 3, missing: 2, duplicated: 1, allPresentAndUnique: false });
  });
});

describe("P1 a partir do corpo e da resposta observados, não da configuração", () => {
  it("corpo sem tool_choice: observado, sem valor; corpo ilegível: indisponível; um legível e um ilegível: parcial", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
    const post = (body: BodyInit) => fetch("http://localhost:11434/v1/chat/completions", { method: "POST", body });
    try {
      const without = await withRequestCapture(() => post(JSON.stringify({ model: "m", stream: true })));
      assert.deepEqual(p1Of(without.requests, "completed").toolChoice, { status: "observed", values: [], observedBodies: 1, unobservedBodies: 0 });
      assert.equal(without.requests[0]?.stream, true);
      const unreadable = await withRequestCapture(() => post(new Uint8Array([1, 2, 3])));
      assert.equal(p1Of(unreadable.requests, "completed").toolChoice.status, "unavailable");
      const partial = await withRequestCapture(async () => {
        await post(JSON.stringify({ tool_choice: "auto" }));
        return post(new Uint8Array([1]));
      });
      assert.deepEqual(p1Of(partial.requests, "completed").toolChoice, { status: "partial", values: ["auto"], observedBodies: 1, unobservedBodies: 1 });
    } finally {
      globalThis.fetch = original;
    }
  });

  it("aceitação HTTP separada do turno: respostas 2xx com turno não concluído, e o inverso", () => {
    const req = (status: number | null) => ({ bodyObserved: true, toolChoice: "auto", toolChoicePresent: true, stream: false, responseFormatPresent: false, status, networkError: null, providerToolCalls: null, rateLimitHeaderCount: 0, modelEndpoint: true });
    const ok2xxFailedTurn = p1Of([req(200)], "instrument_defect");
    assert.deepEqual(ok2xxFailedTurn.providerAccepted, { all: true, count2xx: 1, total: 1 });
    assert.equal(ok2xxFailedTurn.turnCompleted, false);
    const mixedCompleted = p1Of([req(500), req(200)], "completed");
    assert.deepEqual(mixedCompleted.providerAccepted, { all: false, count2xx: 1, total: 2 });
    assert.equal(mixedCompleted.turnCompleted, true);
    assert.equal(p1Of([], "not_executed_quota").providerAccepted, null);
  });
});

describe("cabeçalhos de limite de taxa: só a presença é contada", () => {
  it("resposta sem cabeçalho de limite (como o servidor local do Ollama): 0 de N; com cabeçalho: N de N", async () => {
    const script = [completion([["S1", "submitInterpretation", SUBMIT_C3]])];
    const without = await withFabricatedHttp(script, () => runProbes(optionsFor(OLLAMA, { inputs: [PROBE_INPUTS[1]] })));
    assert.deepEqual((without.result[0] as ProbeEntryRecord).p1.rateLimitHeaders, { responses: 1, responsesWithAny: 0 });
    const withHeader = await withFabricatedHttp(script, () => runProbes(optionsFor(OLLAMA, { inputs: [PROBE_INPUTS[1]] })), { rateLimitHeader: true });
    assert.deepEqual((withHeader.result[0] as ProbeEntryRecord).p1.rateLimitHeaders, { responses: 1, responsesWithAny: 1 });
    assert.equal(JSON.stringify(withHeader.result).includes("100000"), false, "nenhum valor de cabeçalho no registro");
  });
});

describe("falhas", () => {
  it("falha do provider (HTTP 401) com status e erro sanitizados; erro pontual não impede as demais entradas", async () => {
    const { result: entries } = await withFabricatedHttp([fail(401, "Invalid API Key gsk_abc123 Bearer xyz"), textCompletion("oi"), textCompletion("oi")], () => runProbes(optionsFor(OLLAMA)));
    const [e1, e2, e3] = entries as [ProbeEntryRecord, ProbeEntryRecord, ProbeEntryRecord];
    assert.equal(e1.outcome, "execution_error");
    assert.equal(e1.error?.code, "EXEC_PROVIDER_ERROR");
    assert.deepEqual(e1.p1.httpStatuses, [401], "401: o Mastra não repete");
    assert.deepEqual(e1.p1.providerAccepted, { all: false, count2xx: 0, total: 1 });
    assert.equal(e1.p1.turnCompleted, false);
    assert.equal(FORBIDDEN.test(e1.error?.message ?? ""), false, e1.error?.message);
    assert.equal(e2.outcome, "completed");
    assert.equal(e3.outcome, "completed");
  });

  it("HTTP 500 persistente: o Mastra repete duas vezes por conta própria; P1 mostra os três status; passos retry contados", async () => {
    const boom = fail(500, "boom");
    const { result: entries } = await withFabricatedHttp([boom, boom, boom], () => runProbes(optionsFor(OLLAMA, { inputs: [PROBE_INPUTS[1]] })));
    const e = entries[0] as ProbeEntryRecord;
    assert.equal(e.outcome, "execution_error");
    assert.deepEqual(e.p1.httpStatuses, [500, 500, 500]);
    assert.equal(e.attempts?.length, 1, "uma tentativa do runTurn: as repetições são internas do Mastra");
    assert.deepEqual(e.attempts?.[0]?.p4.map((s) => s.finishReason), ["retry", "retry", "error"]);
    assert.equal(e.attempts?.[0]?.retrySteps, 2);
  });

  it("cota diária esgotada: terminal para o modelo; as entradas restantes não são executadas (nenhuma requisição)", async () => {
    const tpd = fail(429, "Rate limit reached: tokens per day (TPD)");
    const { result: entries, urls } = await withFabricatedHttp([tpd, tpd, tpd, textCompletion("NUNCA"), textCompletion("NUNCA")], () => runProbes(optionsFor(OLLAMA)));
    assert.equal(urls.length, 3, "só as três requisições da primeira entrada (duas repetições internas do Mastra)");
    const [e1, e2, e3] = entries as [ProbeEntryRecord, ProbeEntryRecord, ProbeEntryRecord];
    assert.equal(e1.outcome, "quota_exhausted");
    assert.equal(e1.error?.code, "EXEC_QUOTA");
    for (const e of [e2, e3]) {
      assert.equal(e.outcome, "not_executed_quota");
      assert.deepEqual(e.p1.requests, []);
      assert.equal(e.p1.providerAccepted, null);
      assert.equal(e.attempts, null);
    }
  });

  it("defeito do instrumento (InstrumentDefect) é pontual: registrado na entrada; as demais rodam", async () => {
    const { result: entries } = await withFabricatedHttp([textCompletion("a"), textCompletion("b"), textCompletion("c")], () =>
      runProbes(optionsFor(OLLAMA, { invariantCheck: (r) => (r.caseId === "SONDA-1" ? [{ invariant: "I4", detail: "fabricada" }] : []) })),
    );
    assert.deepEqual(entries.map((e) => e.outcome), ["instrument_defect", "completed", "completed"]);
    assert.equal(entries[0]?.error?.code, "INSTRUMENT_DEFECT");
  });
});

describe("reachedStepLimitThresholdWithRetries: condição observada (diagnóstico, sem pontuação)", () => {
  it("cinco passos não-retry de tool de negócio, dois retry, sem submissão aceita: condição observada", async () => {
    const boom = fail(500, "boom");
    const tool = (n: number) => completion([[`L${n}`, "listMyTickets", {}]]);
    const { result: entries } = await withFabricatedHttp([tool(1), boom, tool(2), boom, tool(3), tool(4), tool(5)], () => runProbes(optionsFor(OLLAMA, { inputs: [PROBE_INPUTS[0]] })));
    const a = (entries[0] as ProbeEntryRecord).attempts?.[0];
    assert.equal(a?.nonRetrySteps, 5);
    assert.equal(a?.retrySteps, 2);
    assert.equal(a?.p2.submissionAccepted, false);
    assert.equal(a?.reachedStepLimitThresholdWithRetries, true);
  });

  it("sem passos retry, a condição não é observada, mesmo com cinco passos não-retry (attemptMetrics sobre dados fabricados)", () => {
    const call = (index: number, finishReason: string) => ({ index, inputTokens: 1, outputTokens: 1, latencyMs: 1, finishReason });
    const base = { attempt: 1, errorCode: null, emitted: [], acceptedSubmissions: [] };
    assert.equal(attemptMetrics({ ...base, calls: [0, 1, 2, 3, 4].map((i) => call(i, "tool-calls")) }).reachedStepLimitThresholdWithRetries, false);
    assert.equal(attemptMetrics({ ...base, calls: [call(0, "tool-calls"), call(1, "retry"), ...[2, 3, 4, 5].map((i) => call(i, "tool-calls"))] }).reachedStepLimitThresholdWithRetries, true);
  });
});

describe("Groq (HTTP fabricado): pausa de 60 s entre as entradas", () => {
  it("pausa injetada só entre as entradas; tool_choice observado", async () => {
    const pauses: number[] = [];
    const { result: entries, urls } = await withFabricatedHttp([textCompletion("a"), textCompletion("b"), textCompletion("c")], () =>
      runProbes(optionsFor(GROQ, { pauseMs: undefined, pause: async (ms) => pauses.push(ms) })),
    );
    assert.deepEqual(pauses, [60_000, 60_000]);
    assert.ok(urls.every((u) => new URL(u).host === "api.groq.com"));
    assert.deepEqual(entries.map((e) => e.p1.toolChoice.values), [["auto"], ["auto"], ["auto"]]);
  });
});

describe("registros persistidos: sem argumentos, respostas, texto, raciocínio ou cabeçalhos", () => {
  it("os arquivos gravados não contêm nada disso e passam na conferência de padrões proibidos", async () => {
    const { result: entries } = await withFabricatedHttp(
      [
        completion([["A1", "searchArticles", { query: "SEGREDO-ARG-123" }]], { reasoning_content: "RACIOCINIO-789" }),
        completion([["S1", "submitInterpretation", { ...SUBMIT_C3, entities: { problem: "SEGREDO-INTERP-321" } }]]),
        textCompletion("TEXTO-RESPOSTA-456", { reasoning_content: "RACIOCINIO-789" }),
        textCompletion("TEXTO-RESPOSTA-456"),
      ],
      () => runProbes(optionsFor(OLLAMA)),
      { rateLimitHeader: true },
    );
    const header: ProbeHeader = {
      type: "probe-run", experiment: "v2", model: OLLAMA, modelId: "ollama/qwen3:4b-instruct", provider: "ollama", startedAt: "2026-11-12T00:00:00.000Z",
      digest: "indisponível (teste)", serverContext: 8192, expectedServerContext: 8192, manifest: { files: 28, ok: 28 }, reasoningControl: "teste", pauseMs: 0, inputs: PROBE_INPUTS,
    };
    const dir = mkdtempSync(join(tmpdir(), "sonda-v2-"));
    try {
      const files = writeProbeFiles(header, entries, pathToFileURL(`${dir}/`));
      for (const url of [files.jsonl, files.markdown]) {
        const text = readFileSync(url, "utf8");
        for (const banned of ["SEGREDO-ARG-123", "SEGREDO-INTERP-321", "TEXTO-RESPOSTA-456", "RACIOCINIO-789", "gsk_", "x-ratelimit", "authorization", "Bearer", "100000"]) {
          assert.equal(text.includes(banned), false, `${banned} em ${url.pathname}`);
        }
        assert.equal(FORBIDDEN.test(text), false);
      }
      assert.match(files.jsonl.pathname, /ollama-qwen3-4b-instruct-2026-11-12T00-00-00-000Z\.jsonl$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serialize recusa gravar se algum padrão proibido aparecer", () => {
    const header: ProbeHeader = {
      type: "probe-run", experiment: "v2", model: "m", modelId: "m", provider: "ollama", startedAt: "t", digest: "d", serverContext: 8192,
      expectedServerContext: 8192, manifest: { files: 28, ok: 28 }, reasoningControl: "r", pauseMs: 0, inputs: PROBE_INPUTS,
    };
    const entry = { entry: "SONDA-1", outcome: "failed", error: { code: null, message: "x-ratelimit-remaining: 0" }, p1: p1Of([], "failed"), p3Provider: null, attempts: null, integrity: null } as unknown as ProbeEntryRecord;
    assert.throws(() => serialize(header, [entry]), /padrão proibido/);
  });

  it("stripArgs corta argumentos dos detalhes das invariantes (chave nome|argumentos e JSON)", () => {
    assert.equal(stripArgs('C2, repetição 1: multiconjunto: 1 evento(s) para 0 emissão(ões) de searchArticles|{"query":"SEGREDO"}'), "C2, repetição 1: multiconjunto: 1 evento(s) para 0 emissão(ões) de searchArticles|…");
    assert.equal(stripArgs('toolLog: 1 registro(s) de searchArticles|"texto cru"'), "toolLog: 1 registro(s) de searchArticles|…");
  });
});

describe("métricas sobre dados fabricados", () => {
  it("endedWithTextOnly e p4PerStep usam o índice das chamadas e as emissões observadas", () => {
    const calls = [{ index: 0, inputTokens: 1, outputTokens: 1, latencyMs: 1, finishReason: "tool-calls" }, { index: 1, inputTokens: 1, outputTokens: 1, latencyMs: 1, finishReason: "stop" }];
    const emitted: EmittedCall[] = [{ step: 0, order: 0, toolCallId: "L1", toolName: "listMyTickets", rawArgs: {}, validAtCapture: true }];
    assert.equal(endedWithTextOnly({ calls, emitted }), true, "último passo sem emissão, stop, sem submissão");
    assert.deepEqual(p4PerStep({ calls, emitted }).map((s) => `${s.step}:${s.total}:${s.finishReason}`), ["0:1:tool-calls", "1:0:stop"]);
  });
});

describe("importação sem efeito colateral", () => {
  it("importar probe.ts num processo separado não inicia sondagem nem imprime nada", () => {
    const url = new URL("./probe.ts", import.meta.url).href;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url)});`], { cwd: fileURLToPath(new URL("../../", import.meta.url)), encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, "");
    assert.equal(child.stderr, "");
  });
});
