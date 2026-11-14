// Caminho real do Ollama (model router) com respostas HTTP fabricadas: corpos das duas fases,
// prompt da V1, REASONING_CONTROL, monitor em duas camadas e host fora do endpoint
// (v3/CRITERIA.md, "Desenho", "Reutilização", "Falhas do modelo: códigos"; plano de testes,
// "Execução, tempo e monitor").
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createGroq } from "@ai-sdk/groq";

import { SYSTEM_PROMPT as V1_PROMPT } from "../../src/prompt.ts";
import { REASONING_CONTROL } from "../../src/run.ts";
import { CaptureLayer } from "./phase2.ts";
import { inferenceEndpointOf, runAttempt, runTurn } from "./run.ts";
import { checkInvariantsV3, scoreTurnV3 } from "./score.ts";
import { OLLAMA, OLLAMA_HOST, VALID, caseById, completion, reply, textCompletion, turnInput, withHttp } from "./test-helpers.ts";
import { withRequestMonitor } from "../../v2/src/run.ts";

const valid = JSON.stringify(VALID.C3);
const withReasoningControl = { providerOptions: REASONING_CONTROL.ollama.providerOptions };

describe("corpos das duas fases", () => {
  it("fase 1: doGenerate, tool_choice auto, as quatro tools, sem response_format; fase 2: response_format, sem tools nem tool_choice; prompt da V1 e reasoning_effort none nas duas", async () => {
    const { result, requests } = await withHttp([completion([["L1", "listMyTickets", {}]]), textCompletion("Pronto."), textCompletion(valid)], () => runAttempt(turnInput("C3", withReasoningControl), 1));
    assert.equal(requests.length, 3);
    const [first, , phase2] = requests.map((r) => r.body);
    assert.ok(first && phase2);
    assert.notEqual(first["stream"], true, "o Agent.generate usa doGenerate");
    assert.equal(first["tool_choice"], "auto");
    assert.deepEqual((first["tools"] as { function: { name: string } }[]).map((t) => t.function.name).sort(), ["listMyTickets", "proposeTicketDraft", "requestHandoff", "searchArticles"]);
    assert.equal("response_format" in first, false);
    assert.equal("tools" in phase2, false);
    assert.equal("tool_choice" in phase2, false);
    assert.equal((phase2["response_format"] as { type: string }).type, "json_schema");
    for (const body of [first, phase2]) {
      assert.equal(body["reasoning_effort"], "none", "REASONING_CONTROL da V1 nas duas fases");
      assert.deepEqual((body["messages"] as { role: string; content: string }[])[0], { role: "system", content: V1_PROMPT }, "prompt da V1, sem mudança");
    }
    assert.deepEqual(checkInvariantsV3(result.record), []);
    assert.equal(scoreTurnV3(result.record, caseById("C3")).v1.zodValid, true);
  });
});

describe("monitor em duas camadas", () => {
  it("a mesma requisição é vista pela captura da V3 e pelo monitor da V2.1 (host não permitido: registrado sem bloqueio); o fetch original volta depois", async () => {
    const seen: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      seen.push("fetch");
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const bottom = globalThis.fetch;
    try {
      const layer = new CaptureLayer();
      // Mesma ordem do runAttempt: captura (topo) → monitor da V2.1 → sentinela (base) → fetch.
      const monitored = await layer.aroundBottom(() =>
        withRequestMonitor(["permitido:1"], () =>
          layer.around(async () => {
            const response = await fetch("http://outro-host.exemplo/v1/x", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "x" }] }) });
            seen.push(`status ${response.status}`);
          }),
        ),
      );
      assert.deepEqual(seen, ["fetch", "status 200"], "a requisição chegou ao fetch: nenhum bloqueio");
      assert.deepEqual(monitored.external, ["http://outro-host.exemplo/v1/x"], "o monitor da V2.1 registrou o host não permitido");
      assert.equal(layer.firstPhase1MessageCount, 1, "a captura da V3 viu a mesma requisição");
      assert.equal(layer.reached, 1, "a requisição passou pelo monitor e chegou à sentinela");
      assert.deepEqual(layer.failures, [], "host determinado: não é falha do instrumento");
      assert.equal(globalThis.fetch, bottom, "as duas camadas restauraram o fetch");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("exceção numa das camadas: as duas restauram o fetch em finally", async () => {
    const original = globalThis.fetch;
    const bottom = (async () => new Response("{}")) as typeof fetch;
    globalThis.fetch = bottom;
    try {
      const layer = new CaptureLayer(() => {
        throw new Error("falha simulada da camada");
      });
      await assert.rejects(withRequestMonitor([], () => layer.around(() => fetch("http://h.exemplo/x", { body: "{}" }))));
      assert.equal(globalThis.fetch, bottom);
      assert.equal(layer.failures[0]?.layer, "captura");
    } finally {
      globalThis.fetch = original;
    }
  });
});

// Servidor fabricado que, ao atender a requisição de inferência de número `trigger`, faz antes uma
// outra requisição pelo fetch global (passa pela captura da V3 e pelo monitor da V2.1, como uma
// requisição no meio do turno). Essa outra requisição responde 200 sem consumir o roteiro.
const INFERENCE = inferenceEndpointOf("ollama", OLLAMA.config);
async function withSideRequestAt<T>(trigger: number, side: { url: string; method: string }, script: unknown[], fn: () => Promise<T>) {
  const original = globalThis.fetch;
  const model: string[] = [];
  const others: string[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url !== INFERENCE || (init?.method ?? "GET").toUpperCase() !== "POST") {
      others.push(`${(init?.method ?? "GET").toUpperCase()} ${url}`);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }
    model.push(url);
    if (model.length === trigger) await globalThis.fetch(side.url, { method: side.method, ...(side.method === "POST" ? { body: "x" } : {}) });
    const body = script[model.length - 1] ?? textCompletion("FORA DO ROTEIRO");
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    return { result: await fn(), model, external: others, others };
  } finally {
    globalThis.fetch = original;
  }
}
const EXTERNAL = { url: "http://externo.exemplo/efeito", method: "POST" };
const SAME_HOST_OTHER_ROUTE = { url: `http://${OLLAMA_HOST}/api/tags`, method: "GET" };
const withExternalAt = <T>(trigger: number, script: unknown[], fn: () => Promise<T>) => withSideRequestAt(trigger, EXTERNAL, script, fn);

describe("URL de inferência derivada do código instalado × URL observada", () => {
  it("Ollama (model router): toda requisição do turno é POST para inferenceEndpointOf", async () => {
    const { requests } = await withHttp([completion([["L1", "listMyTickets", {}]]), textCompletion("Pronto."), textCompletion(valid)], () => runAttempt(turnInput("C3"), 1));
    assert.equal(INFERENCE, `http://${OLLAMA_HOST}/v1/chat/completions`);
    assert.deepEqual(requests.map((r) => `${r.method} ${r.url}`), [`POST ${INFERENCE}`, `POST ${INFERENCE}`, `POST ${INFERENCE}`]);
  });

  it("Groq (@ai-sdk/groq): POST para inferenceEndpointOf, reconhecida pela captura nas duas fases", async () => {
    const groq = createGroq({ apiKey: "chave-ficticia-de-teste" })("openai/gpt-oss-120b");
    const endpoint = inferenceEndpointOf("groq", groq as never);
    assert.equal(endpoint, "https://api.groq.com/openai/v1/chat/completions");
    const { result, requests } = await withHttp([completion([["L1", "listMyTickets", {}]]), textCompletion("Pronto."), textCompletion(valid)], () =>
      runAttempt({ ...turnInput("C3"), model: groq as never, modelLabel: "groq openai/gpt-oss-120b", provider: "groq", allowedHosts: ["api.groq.com"] }, 1),
    );
    assert.deepEqual(requests.map((r) => `${r.method} ${r.url}`), [`POST ${endpoint}`, `POST ${endpoint}`, `POST ${endpoint}`]);
    assert.equal(result.record.phase1.modelRequests, 2);
    assert.equal(result.record.phase2?.request.requests, 1);
  });

  it("classificação pela camada: só POST para a URL de inferência da fase conta", () => {
    const layer = new CaptureLayer(undefined, { 1: INFERENCE, 2: INFERENCE });
    assert.equal(layer.isInference(INFERENCE ?? "", { method: "POST" }, 1), true);
    assert.equal(layer.isInference(INFERENCE ?? "", { method: "GET" }, 1), false, "outro método");
    assert.equal(layer.isInference(`http://${OLLAMA_HOST}/api/tags`, { method: "POST" }, 2), false, "outra rota no mesmo host");
    assert.equal(layer.isInference("http://externo.exemplo/v1/chat/completions", { method: "POST" }, 2), false, "outro host");
  });
});

describe("outra rota no mesmo host permitido (ex.: /api/tags), no meio do turno", () => {
  const script = [completion([["L1", "listMyTickets", {}]]), completion([["A1", "searchArticles", { query: "vpn" }]]), textCompletion("Pronto."), textCompletion(valid)];

  it("fase 1: não avança o passo, não é capturada; emissões alinhadas com result.steps; sem externa nem defeito", async () => {
    const { result, others } = await withSideRequestAt(1, SAME_HOST_OTHER_ROUTE, script, () => runTurn(turnInput("C3")));
    assert.deepEqual(others, [`GET http://${OLLAMA_HOST}/api/tags`], "a requisição seguiu ao servidor");
    assert.deepEqual(result.phase1.calls.map((c) => c.finishReason), ["tool-calls", "tool-calls", "stop"]);
    assert.deepEqual(result.phase1.emitted.map((e) => `${e.step}:${e.toolCallId}`), ["0:L1", "1:A1"]);
    assert.equal(result.phase1.modelRequests, result.phase1.calls.length, "só as requisições de inferência foram capturadas");
    assert.deepEqual(result.externalRequests, [], "host permitido: não é externa");
    assert.deepEqual(result.instrumentFailures, []);
    assert.equal(result.status, "completed");
    assert.deepEqual(checkInvariantsV3(result), []);
  });

  it("fase 2: não entra na contagem da I4 nem na comparação B; sem falsa violação", async () => {
    const { result, others } = await withSideRequestAt(4, SAME_HOST_OTHER_ROUTE, script, () => runTurn(turnInput("C3")));
    assert.equal(others.length, 1);
    assert.equal(result.phase2?.request.requests, 1, "só a requisição de inferência");
    assert.deepEqual(result.fidelity, { violations: [], diagnostics: [] });
    assert.deepEqual(result.externalRequests, []);
    assert.equal(result.status, "completed");
    assert.deepEqual(checkInvariantsV3(result), []);
  });
});

describe("requisição a outro host no meio do turno (registrada como externa, sem bloqueio)", () => {
  const script = [completion([["L1", "listMyTickets", {}]]), completion([["A1", "searchArticles", { query: "vpn" }]]), textCompletion("Pronto."), textCompletion(valid)];

  it("fase 1: não avança o passo; emissões alinhadas com result.steps; EXEC_EXTERNAL_EFFECT, sem defeito", async () => {
    const { result, model, external } = await withExternalAt(1, script, () => runTurn(turnInput("C3")));
    assert.equal(model.length, 4);
    assert.deepEqual(external, ["POST http://externo.exemplo/efeito"], "chegou ao servidor: nenhum bloqueio");
    assert.deepEqual(result.externalRequests, ["http://externo.exemplo/efeito"], "o monitor da V2.1 registrou");
    assert.deepEqual(result.phase1.calls.map((c) => c.finishReason), ["tool-calls", "tool-calls", "stop"]);
    assert.deepEqual(result.phase1.emitted.map((e) => `${e.step}:${e.toolCallId}`), ["0:L1", "1:A1"], "o passo não avançou pela requisição externa");
    assert.deepEqual(result.instrumentFailures, []);
    assert.deepEqual(checkInvariantsV3(result), []);
    assert.equal(scoreTurnV3(result, caseById("C3")).v1.execCode, "EXEC_EXTERNAL_EFFECT");
  });

  it("fase 2: fora da contagem da I4 e da comparação B; EXEC_EXTERNAL_EFFECT, sem defeito", async () => {
    const { result, external } = await withExternalAt(4, script, () => runTurn(turnInput("C3")));
    assert.equal(external.length, 1);
    assert.equal(result.phase2?.request.requests, 1, "só a requisição ao modelo");
    assert.deepEqual(result.fidelity.violations, []);
    assert.deepEqual(result.instrumentFailures, []);
    assert.deepEqual(checkInvariantsV3(result), []);
    assert.equal(scoreTurnV3(result, caseById("C3")).v1.execCode, "EXEC_EXTERNAL_EFFECT");
  });
});

describe("último passo da fase 1 fechado também quando o generate termina em erro", () => {
  it("tool seguida de 401: a emissão fica no passo 0, os passos ficam fechados, sem invariante falsa", async () => {
    const { result } = await withHttp([completion([["L1", "listMyTickets", {}]]), reply(401, { error: { message: "Invalid API Key" } })], () => runAttempt(turnInput("C3"), 1));
    const r = result.record;
    assert.deepEqual(r.phase1.calls.map((c) => c.finishReason), ["tool-calls", "error"]);
    assert.deepEqual(r.phase1.emitted.map((e) => `${e.step}:${e.toolCallId}`), ["0:L1"]);
    assert.deepEqual(r.phase1.steps.map((s) => s.index), [0, 1], "os dois passos fechados");
    assert.equal(r.execError?.code, "EXEC_PROVIDER_ERROR");
    assert.deepEqual(checkInvariantsV3(r), []);
  });

  it("tool seguida de 500 persistente (o generate lança): a emissão fica no passo 0; passos alinhados às chamadas; sem invariante falsa", async () => {
    const e500 = reply(500, { error: { message: "x" } });
    const { result } = await withHttp([completion([["L1", "listMyTickets", {}]]), e500, e500, e500], () => runAttempt(turnInput("C3"), 1));
    const r = result.record;
    assert.deepEqual(r.phase1.calls.map((c) => c.finishReason), ["tool-calls", "retry", "retry", "error"]);
    assert.deepEqual(r.phase1.emitted.map((e) => `${e.step}:${e.toolCallId}`), ["0:L1"]);
    assert.deepEqual(r.phase1.steps.map((s) => s.index), [0, 1, 2, 3], "um passo do protocolo por chamada");
    assert.equal(r.execError?.code, "EXEC_PROVIDER_ERROR");
    assert.deepEqual(checkInvariantsV3(r), []);
  });
});

// onStepFinish fora de ordem (v3/CRITERIA.md, "Ajustes da implementação", item 10). Quando uma
// resposta traz x-ratelimit-remaining-tokens entre 1 e 1999, o Mastra 1.81.0 adia ~10 s os
// onStepFinish seguintes, mas o laço continua: as requisições e os chunks tool-call dos passos
// seguintes chegam ANTES dos onStepFinish. Medido com HTTP fabricado nos caminhos do Groq e do model
// router (Ollama), com e sem 429/500. A V3 delimita os passos da fase 1 pelo início de cada
// requisição (visto em tempo real pela camada de captura), não pelo onStepFinish.
const LOW = { "x-ratelimit-remaining-tokens": "1" };

describe("onStepFinish adiado pela pausa de limite de taxa (caminho do model router)", () => {
  it("tool (limite baixo) → 500 → tool → tool → texto: passos do protocolo = índices de result.steps; sem falsa I1 nem falsa I10", async () => {
    const { result, requests } = await withHttp(
      [
        reply(200, completion([["L1", "listMyTickets", {}]]), LOW),
        reply(500, { error: { message: "x" } }),
        completion([["A1", "searchArticles", { query: "vpn" }]]),
        completion([["P1", "requestHandoff", {}]]),
        textCompletion("Pronto."),
        textCompletion(valid),
      ],
      () => runAttempt(turnInput("C3"), 1),
    );
    const r = result.record;
    assert.equal(requests.length, 6);
    assert.deepEqual(r.phase1.calls.map((c) => c.finishReason), ["tool-calls", "retry", "tool-calls", "tool-calls", "stop"]);
    // Cada emissão no passo do protocolo igual ao índice da chamada que a produziu em result.steps.
    assert.deepEqual(r.phase1.emitted.map((e) => `${e.step}:${e.toolCallId}`), ["0:L1", "2:A1", "3:P1"]);
    assert.deepEqual(r.phase1.executions.map((e) => `${e.step}:${e.toolCallId}`), ["0:L1", "2:A1", "3:P1"]);
    assert.deepEqual(r.phase1.steps.map((s) => s.lateChunks), r.phase1.steps.map(() => 0), "nenhum chunk depois do selo");
    assert.deepEqual(r.fidelity, { violations: [], diagnostics: [] });
    assert.deepEqual(checkInvariantsV3(r), []);
    // Latência por chamada pelas requisições: o passo retry não carrega a pausa de 10 s.
    assert.ok((r.phase1.calls[1]?.latencyMs ?? 0) < 9_000, `latência do retry: ${r.phase1.calls[1]?.latencyMs} ms`);
  });

  it("tool (limite baixo) → tool → tool → texto, sem erro: dois passos distintos não se fundem", async () => {
    const { result } = await withHttp(
      [reply(200, completion([["L1", "listMyTickets", {}]]), LOW), completion([["A1", "searchArticles", { query: "vpn" }]]), completion([["P1", "requestHandoff", {}]]), textCompletion("Pronto."), textCompletion(valid)],
      () => runAttempt(turnInput("C3"), 1),
    );
    const r = result.record;
    assert.deepEqual(r.phase1.emitted.map((e) => `${e.step}:${e.toolCallId}`), ["0:L1", "1:A1", "2:P1"]);
    assert.deepEqual(checkInvariantsV3(r), []);
  });
});
