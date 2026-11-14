// Invariantes I1–I10 (um teste positivo e um negativo para cada) e falha do instrumento, inclusive a
// precedência do InstrumentDefect (latch). v3/CRITERIA.md, "Invariantes do instrumento", "Falha do
// instrumento"; plano de testes, "Invariantes" e "Falha do instrumento".
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";

import { Agent } from "@mastra/core/agent";
import { noopLogger } from "@mastra/core/logger";
import { MastraLanguageModelV2Mock } from "@mastra/core/test-utils/llm-mock";

import { SYSTEM_PROMPT } from "../../src/prompt.ts";
import { toMessages } from "../../src/run.ts";
import { createFakeTools } from "../../src/tools.ts";
import { TurnProtocol } from "../../v2/src/protocol.ts";
import { CaptureLayer } from "./phase2.ts";
import type { InvariantViolationV3, TurnRecordV3 } from "./record.ts";
import { InstrumentDefect, runAttempt, runModel, runTurn, writeRound, type RunOptionsV3 } from "./run.ts";
import { checkInvariantsV3 } from "./score.ts";
import { OLLAMA, OLLAMA_HOST, VALID, caseById, cases, completion, error429, okPhase1, okPhase2, okRecord, textCompletion, turnInput, withHttp } from "./test-helpers.ts";

const valid = JSON.stringify(VALID.C3);
const ids = (r: TurnRecordV3) => checkInvariantsV3(r).map((v) => v.invariant);
const call = (finishReason: string, index = 0) => ({ index, inputTokens: 900, outputTokens: 20, latencyMs: 1, finishReason });

// I1: chunk tool-call depois do selo, como na V2.1 (doStream com atraso; execução antecipada do stream).
async function streamedProtocol(eagerToolExecution: boolean) {
  const model = new MastraLanguageModelV2Mock({
    doStream: (async () => ({
      stream: new ReadableStream({
        async start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "tool-call", toolCallId: "L1", toolName: "listMyTickets", input: "{}" });
          await delay(80);
          controller.enqueue({ type: "tool-call", toolCallId: "A1", toolName: "searchArticles", input: JSON.stringify({ query: "vpn" }) });
          controller.enqueue({ type: "finish", finishReason: "tool-calls", usage: { inputTokens: 900, outputTokens: 20, totalTokens: 920 } });
          controller.close();
        },
      }),
    })) as never,
  });
  const protocol = new TurnProtocol();
  const { tools } = createFakeTools();
  const agent = new Agent({ id: "v3-i1", name: "v3-i1", instructions: SYSTEM_PROMPT, model, tools });
  agent.__setLogger(noopLogger);
  const output = await agent.stream(toMessages(caseById("C3")), { maxSteps: 1, toolChoice: "auto", modelSettings: { maxRetries: 0 }, eagerToolExecution, onChunk: protocol.onChunk, onStepFinish: () => protocol.onStepFinish(), hooks: protocol.hooks } as never);
  await (output as { getFullOutput: () => Promise<unknown> }).getFullOutput();
  return protocol;
}

describe("invariantes: positivo (não dispara) e negativo (dispara)", () => {
  it("registro de base: nenhuma invariante dispara", () => {
    assert.deepEqual(checkInvariantsV3(okRecord()), []);
  });

  it("I1: chunks antes do primeiro beforeToolCall → não dispara; chunk depois do selo → dispara", async () => {
    const ok = await streamedProtocol(false);
    assert.deepEqual(ids(okRecord({ phase1: { ...okPhase1(), steps: ok.steps() } })), []);
    const late = await streamedProtocol(true);
    assert.ok(late.steps().some((s) => s.lateChunks > 0), "a execução antecipada quebra a premissa");
    assert.ok(ids(okRecord({ phase1: { ...okPhase1(), steps: late.steps() } })).includes("I1"));
  });

  it("I2: 5 passos de inferência com retry entre eles → não dispara; 6 → dispara", () => {
    const five = ["tool-calls", "retry", "tool-calls", "tool-calls", "retry", "tool-calls", "stop"].map((f, i) => call(f, i));
    assert.ok(!ids(okRecord({ phase1: { ...okPhase1(), calls: five } })).includes("I2"));
    const six = ["tool-calls", "tool-calls", "tool-calls", "tool-calls", "tool-calls", "stop"].map((f, i) => call(f, i));
    assert.ok(ids(okRecord({ phase1: { ...okPhase1(), calls: six } })).includes("I2"));
  });

  it("I3: MASTRA_REFUSED + EXECUTED reconciliados → não dispara; execução sem emissão, toolLog divergente ou MASTRA_REFUSED válido → dispara", () => {
    const refusedAndExecuted = {
      ...okPhase1(),
      emitted: [
        { step: 0, order: 0, toolCallId: "S1", toolName: "searchArticles", rawArgs: { query: "" }, validAtCapture: false },
        { step: 0, order: 1, toolCallId: "L1", toolName: "listMyTickets", rawArgs: {}, validAtCapture: true },
      ],
      executions: [
        { step: 0, toolCallId: "S1", toolName: "searchArticles", outcome: "MASTRA_REFUSED" as const, args: { query: "" }, validAtCapture: false },
        { step: 0, toolCallId: "L1", toolName: "listMyTickets", outcome: "EXECUTED" as const, args: {}, validAtCapture: true },
      ],
    };
    assert.ok(!ids(okRecord({ phase1: refusedAndExecuted })).includes("I3"));
    const noEmission = { ...okPhase1(), emitted: [] };
    assert.ok(ids(okRecord({ phase1: noEmission, phase2: okPhase2() })).includes("I3"));
    const divergentLog = { ...okPhase1(), toolLog: [{ tool: "searchArticles", args: { query: "x" } }] };
    assert.ok(ids(okRecord({ phase1: divergentLog })).includes("I3"));
    const refusedButValid = { ...refusedAndExecuted, executions: [{ ...refusedAndExecuted.executions[0]!, validAtCapture: true }, refusedAndExecuted.executions[1]!] };
    assert.ok(ids(okRecord({ phase1: refusedButValid })).includes("I3"));
  });

  it("I4: sem tools, sem tool_choice, com response_format em todas → não dispara; com tools, sem response_format ou requisição não capturada → dispara", () => {
    const base = okPhase2();
    assert.ok(!ids(okRecord({ phase2: base })).includes("I4"));
    assert.ok(ids(okRecord({ phase2: { ...base, request: { ...base.request, anyTools: true } } })).includes("I4"));
    assert.ok(ids(okRecord({ phase2: { ...base, request: { ...base.request, anyToolChoice: true } } })).includes("I4"));
    assert.ok(ids(okRecord({ phase2: { ...base, request: { ...base.request, allResponseFormat: false } } })).includes("I4"));
    assert.ok(ids(okRecord({ phase2: { ...base, request: { ...base.request, requests: 0 } } })).includes("I4"));
  });

  it("I4: capturas = total de passos da fase 2 (lista completa) → não dispara; diferente → dispara; cancelada: capturas ≥ passos", () => {
    const two = [call("retry", 0), call("stop", 1)];
    assert.ok(!ids(okRecord({ phase2: { ...okPhase2(), calls: two, request: { ...okPhase2().request, requests: 2 } } })).includes("I4"));
    assert.ok(ids(okRecord({ phase2: { ...okPhase2(), calls: two, request: { ...okPhase2().request, requests: 1 } } })).includes("I4"), "uma requisição a menos");
    assert.ok(ids(okRecord({ phase2: { ...okPhase2(), calls: two, request: { ...okPhase2().request, requests: 3 } } })).includes("I4"), "uma requisição a mais");
    const aborted = { ...okPhase2(), stepsObservable: false, finishReason: "aborted", calls: [] };
    assert.ok(!ids(okRecord({ phase2: { ...aborted, request: { ...okPhase2().request, requests: 1 } } })).includes("I4"));
    assert.ok(ids(okRecord({ phase2: { ...aborted, calls: [call("retry", 0)], request: { ...okPhase2().request, requests: 0 } } })).includes("I4"));
  });

  describe("I4 em execução real: servidor fabricado × captura × passos da fase 2", () => {
    const e500 = { status: 500, body: { error: { message: "x" } } };
    const cases4: [string, unknown[], number, string[]][] = [
      ["sucesso", [textCompletion(valid)], 1, ["stop"]],
      ["500 → retry → sucesso", [e500, textCompletion(valid)], 2, ["retry", "stop"]],
      ["500 persistente", [e500, e500, e500], 3, ["retry", "retry", "error"]],
    ];
    for (const [name, phase2Script, n, finishReasons] of cases4) {
      it(`${name}: ${n} requisição(ões) no servidor = ${n} capturada(s) = ${n} passo(s)`, async () => {
        const { result, requests } = await withHttp([textCompletion("Certo."), ...phase2Script], () => runAttempt(turnInput("C3"), 1));
        const p2 = result.record.phase2;
        assert.equal(requests.length - 1, n, "servidor (descontada a fase 1)");
        assert.equal(p2?.request.requests, n, "captura");
        assert.deepEqual(p2?.calls.map((c) => c.finishReason), finishReasons);
        assert.equal(p2?.stepsObservable, true);
        assert.deepEqual(checkInvariantsV3(result.record), []);
      });
    }
    it("cancelada por tempo (finishReason aborted): capturas ≥ passos", async () => {
      const { result, requests } = await withHttp([textCompletion("Certo."), { status: 200, body: textCompletion(valid), delayMs: 500 }], () => runAttempt(turnInput("C3", { timeoutMs: 250 }), 1));
      const p2 = result.record.phase2;
      assert.equal(p2?.finishReason, "aborted");
      assert.equal(p2?.stepsObservable, false);
      assert.equal(requests.length - 1, 1);
      assert.ok((p2?.request.requests ?? 0) >= (p2?.calls.length ?? 0));
      assert.deepEqual(checkInvariantsV3(result.record), []);
    });
  });

  it("I5: retry seguido de um passo de inferência → não dispara; dois passos de inferência → dispara", () => {
    assert.ok(!ids(okRecord({ phase2: { ...okPhase2(), calls: [call("retry", 0), call("stop", 1)], request: { ...okPhase2().request, requests: 2 } } })).includes("I5"));
    assert.ok(ids(okRecord({ phase2: { ...okPhase2(), calls: [call("tool-calls", 0), call("stop", 1)], request: { ...okPhase2().request, requests: 2 } } })).includes("I5"));
  });

  it("I6: toolLog estável → não dispara; toolLog crescendo na fase 2 → dispara", () => {
    assert.ok(!ids(okRecord()).includes("I6"));
    assert.ok(ids(okRecord({ phase2: { ...okPhase2(), toolLogGrowth: 1 } })).includes("I6"));
  });

  it("I7: fase 1 concluída → uma fase 2; fase 1 em EXEC_* → nenhuma; violações nos três desvios", () => {
    assert.ok(!ids(okRecord()).includes("I7"));
    const failed = { ...okPhase1(), status: "execution_error" as const, execError: { code: "EXEC_PROVIDER_ERROR" as const, message: "x" } };
    assert.ok(!ids(okRecord({ phase1: failed, phase2: null, phase2Invocations: 0, status: "execution_error" })).includes("I7"));
    assert.ok(ids(okRecord({ phase2: null, phase2Invocations: 0 })).includes("I7"), "ausente depois de fase 1 concluída");
    assert.ok(ids(okRecord({ phase1: failed })).includes("I7"), "presente depois de fase 1 em EXEC_*");
    assert.ok(ids(okRecord({ phase2Invocations: 2 })).includes("I7"), "duas vezes");
  });

  it("I8: fase 1 com raciocínio, filtrado (caminho real) → não dispara; corpo com reasoning_content → dispara", async () => {
    const { result } = await withHttp([completion([["L1", "listMyTickets", {}]], { content: null }), textCompletion("Pronto.", { reasoning: "SEGREDO" }), textCompletion(valid)], () => runAttempt(turnInput("C3"), 1));
    assert.equal(result.record.phase2?.request.anyReasoning, false);
    assert.ok(!ids(result.record).includes("I8"));
    // A captura reconhece raciocínio num corpo da fase 2 (sem o filtro).
    const layer = new CaptureLayer();
    layer.phase = 2;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("{}")) as typeof fetch;
    try {
      await layer.aroundBottom(() => layer.around(() => fetch("http://h.exemplo/x", { body: JSON.stringify({ messages: [{ role: "assistant", content: "x", reasoning_content: "SEGREDO" }], response_format: {} }) })));
    } finally {
      globalThis.fetch = original;
    }
    assert.ok(ids(okRecord({ phase2: { ...okPhase2(), request: layer.requestSummary() } })).includes("I8"));
  });

  it("I9: uma interpretação válida → não dispara; duas → dispara", () => {
    assert.ok(!ids(okRecord()).includes("I9"));
    assert.ok(ids(okRecord({ phase2: { ...okPhase2(), validInterpretations: 2 } })).includes("I9"));
  });

  it("I10: transcrição fiel → não dispara; violação de fidelidade → dispara (casos detalhados em transcript.test.ts)", () => {
    assert.ok(!ids(okRecord({ fidelity: { violations: [], diagnostics: ["A, passo 1: modo alternativo"] } })).includes("I10"));
    assert.ok(ids(okRecord({ fidelity: { violations: ["B, passo 1: argumentos divergem"], diagnostics: [] } })).includes("I10"));
  });

  it("tentativa anterior com violação também dispara (identificada pela tentativa)", () => {
    const previous = { ...okRecord(), attempt: 1, status: "execution_error" as const, phase2: { ...okPhase2(), toolLogGrowth: 1 } };
    const v = checkInvariantsV3({ ...okRecord(), attempt: 2, attempts: 2, previousAttempts: [previous] });
    assert.ok(v.some((x) => x.invariant === "I6" && x.detail.includes("(tentativa 1)")));
  });

  it("violação no aquecimento aborta antes dos turnos", async () => {
    const flagsWarmup = (r: TurnRecordV3): InvariantViolationV3[] => (r.repetition === 0 ? [{ invariant: "I9", detail: "fabricada no aquecimento" }] : []);
    const { result, requests } = await withHttp([textCompletion("Olá!"), textCompletion(valid)], () =>
      runModel({ model: OLLAMA.config, modelLabel: OLLAMA.label, provider: "ollama", allowedHosts: [OLLAMA_HOST], cases, invariantCheck: flagsWarmup }),
    );
    assert.equal(result.aborted?.at, "aquecimento");
    assert.equal(result.records.length, 0);
    assert.equal(requests.length, 2, "só o aquecimento");
  });
});

// ---------------------------------------------------------------------------

const roundOptions = (extra: Partial<RunOptionsV3> = {}): RunOptionsV3 => ({ model: OLLAMA.config, modelLabel: OLLAMA.label, provider: "ollama", allowedHosts: [OLLAMA_HOST], cases, ...extra });

function writtenRound(round: Awaited<ReturnType<typeof runModel>>) {
  const dir = mkdtempSync(join(tmpdir(), "spike-v3-"));
  try {
    const header = { type: "run", experiment: "v3", model: OLLAMA.label, provider: "ollama", startedAt: "t", packages: {}, manifest: [], modelDigest: null, settings: {}, reasoningControl: "", allowedHosts: [], warmup: round.warmup, aborted: round.aborted, testHooksUsed: [] } as const;
    const files = writeRound(pathToFileURL(`${dir}/`), "rodada", header as never, round.records, [], null);
    return { jsonl: readFileSync(files.jsonl, "utf8"), summary: readFileSync(files.summary, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("falha do instrumento: InstrumentDefect", () => {
  for (const point of ["captura:1", "captura:2", "filtro", "fidelidade"] as const) {
    it(`exceção na camada "${point}": InstrumentDefect; nenhum EXEC_*; o fetch original volta`, async () => {
      let restored = false;
      const { result } = await withHttp([completion([["L1", "listMyTickets", {}]]), textCompletion("Pronto."), textCompletion(valid)], async () => {
        const bottom = globalThis.fetch;
        const outcome = await runTurn(turnInput("C3", { fault: (p) => { if (p === point) throw new Error(`falha simulada em ${p}`); } })).then(
          () => null,
          (error: unknown) => error,
        );
        restored = globalThis.fetch === bottom;
        return outcome;
      });
      assert.ok(result instanceof InstrumentDefect, String(result));
      assert.equal(result.record.status, "instrument_defect");
      assert.equal(result.record.execError, null, "nunca vira EXEC_*");
      assert.ok(result.failures.length > 0);
      assert.ok(restored, "globalThis.fetch restaurado em finally");
      if (point === "captura:1") assert.equal(result.record.phase2Invocations, 0, "defeito na fase 1: a fase 2 não roda");
    });
  }

  it("rodada com defeito na captura: abortada, e o arquivo de resultados é gravado com o motivo", async () => {
    const { result } = await withHttp([textCompletion("Olá!")], () => runModel(roundOptions({ fault: (p) => { if (p === "captura:1") throw new Error("falha simulada"); } })));
    assert.ok(result.aborted !== null);
    assert.ok(result.aborted.failures.some((f) => f.layer === "captura"));
    const files = writtenRound(result);
    assert.ok(files.jsonl.includes("falha simulada"));
    assert.ok(files.summary.includes("Rodada abortada") && files.summary.includes("Sem veredito"));
  });

  it("exceção na reconciliação (verificador): InstrumentDefect com a camada registrada", async () => {
    const throwing = () => {
      throw new Error("verificador quebrado");
    };
    const { result } = await withHttp([textCompletion("Certo."), textCompletion(valid)], () => runTurn(turnInput("C3"), throwing).then(() => null, (e: unknown) => e));
    assert.ok(result instanceof InstrumentDefect);
    assert.equal(result.failures[0]?.layer, "reconciliação");
  });

  it("exceção inesperada fora das camadas: a rodada é abortada e o arquivo é gravado com o motivo", async () => {
    // C1 com histórico inválido: o aquecimento (histórico vazio) passa; o primeiro turno lança no toMessages.
    const broken = cases.map((c, i) => (i === 0 ? { ...c, history: null as never } : c));
    const { result } = await withHttp([textCompletion("Olá!"), textCompletion(valid)], () => runModel(roundOptions({ cases: broken })));
    assert.ok(result.aborted?.reason.startsWith("exceção inesperada"), JSON.stringify(result.aborted));
    const files = writtenRound(result);
    assert.ok(files.jsonl.includes("exceção inesperada"));
    assert.ok(files.summary.includes("Motivo: exceção inesperada"));
  });
});

describe("host indeterminado: bloqueado, sem delegar", () => {
  // URL sem host. O fetch fabricado responde 429: se a requisição fosse delegada, o Mastra veria um
  // erro com statusCode 429 (EXEC_RATE_LIMIT e nova tentativa, sem o latch).
  const noHost = { id: "ollama/qwen3:4b-instruct", url: "file:///v1" };

  it("fase 1: InstrumentDefect; nenhuma requisição chega ao servidor; nada registrado como externa; a fase 2 não roda", async () => {
    const { result, requests } = await withHttp([error429(), error429(), error429(), textCompletion("Certo.")], () =>
      runTurn(turnInput("C3", { model: noHost as never })).then(() => null, (e: unknown) => e),
    );
    assert.ok(result instanceof InstrumentDefect, String(result));
    assert.ok(result.failures.some((f) => f.layer === "monitor" && f.phase === 1 && f.detail.includes("host indeterminado")));
    assert.equal(requests.length, 0, "nenhuma requisição chegou ao servidor fabricado");
    assert.deepEqual(result.record.externalRequests, [], "o monitor da V2.1 não viu a requisição");
    assert.equal(result.record.execError, null);
    assert.equal(result.record.attempts, 1, "nenhuma nova tentativa");
    assert.equal(result.record.phase2Invocations, 0);
  });

  it("fase 2: InstrumentDefect; só a requisição da fase 1 chega ao servidor; nada registrado como externa", async () => {
    const { result, requests } = await withHttp([textCompletion("Certo."), error429(), error429(), error429()], () =>
      runTurn(turnInput("C3", { phase2Model: noHost as never })).then(() => null, (e: unknown) => e),
    );
    assert.ok(result instanceof InstrumentDefect, String(result));
    assert.ok(result.failures.some((f) => f.layer === "monitor" && f.phase === 2 && f.detail.includes("host indeterminado")));
    assert.equal(requests.length, 1, "só a fase 1");
    assert.deepEqual(result.record.externalRequests, []);
    assert.equal(result.record.status, "instrument_defect");
    assert.equal(result.record.attempts, 1);
  });

  const roundCases: [number, Partial<RunOptionsV3>, unknown[]][] = [
    [1, { model: noHost as never }, [textCompletion("Olá!")]],
    [2, { phase2Model: noHost as never }, [textCompletion("Olá!"), textCompletion(valid)]],
  ];
  for (const [phase, extra, script] of roundCases) {
    it(`rodada com host indeterminado na fase ${phase}: abortada, arquivo gravado com o motivo`, async () => {
      const { result } = await withHttp(script, () => runModel(roundOptions(extra)));
      assert.ok(result.aborted?.failures.some((f) => f.phase === phase && f.detail.includes("host indeterminado")), JSON.stringify(result.aborted));
      const files = writtenRound(result);
      assert.ok(files.jsonl.includes("host indeterminado"));
      assert.ok(files.summary.includes("Sem veredito"));
    });
  }
});

describe("monitor injetável (padrão: withRequestMonitor da V2.1)", () => {
  it("monitor que lança antes de rodar: InstrumentDefect; nenhum EXEC_*; nenhuma requisição", async () => {
    const throwing = (async () => {
      throw new Error("monitor quebrado");
    }) as never;
    const { result, requests } = await withHttp([textCompletion("Certo."), textCompletion(valid)], () => runTurn(turnInput("C3", { monitor: throwing })).then(() => null, (e: unknown) => e));
    assert.ok(result instanceof InstrumentDefect, String(result));
    assert.ok(result.failures.some((f) => f.layer === "monitor" && f.detail.includes("monitor quebrado")));
    assert.equal(result.record.execError, null);
    assert.equal(requests.length, 0);
  });

  it("monitor que lança em cada requisição: InstrumentDefect (não EXEC_PROVIDER_ERROR, EXEC_RATE_LIMIT nem EXEC_EXTERNAL_EFFECT)", async () => {
    const failing = (async (_hosts: readonly string[], fn: () => Promise<unknown>) => {
      const below = globalThis.fetch;
      globalThis.fetch = (() => {
        throw new Error("monitor falhou na requisição");
      }) as typeof fetch;
      try {
        return { result: await fn(), external: [] };
      } finally {
        globalThis.fetch = below;
      }
    }) as never;
    const { result, requests } = await withHttp([textCompletion("Certo."), textCompletion(valid)], () => runTurn(turnInput("C3", { monitor: failing })).then(() => null, (e: unknown) => e));
    assert.ok(result instanceof InstrumentDefect, String(result));
    assert.ok(result.failures.some((f) => f.layer === "monitor" && f.detail.includes("monitor falhou")));
    assert.equal(result.record.execError, null);
    assert.equal(result.record.phase2Invocations, 0);
    assert.equal(requests.length, 0);
  });

  it("monitor que responde sem delegar: latch marcado, e as repetições internas do Mastra também são bloqueadas", async () => {
    let monitorCalls = 0;
    const fake = (async (_hosts: readonly string[], fn: () => Promise<unknown>) => {
      const below = globalThis.fetch;
      globalThis.fetch = (async () => {
        monitorCalls += 1;
        return new Response(JSON.stringify({ error: { message: "x" } }), { status: 500, headers: { "content-type": "application/json" } });
      }) as typeof fetch;
      try {
        return { result: await fn(), external: [] };
      } finally {
        globalThis.fetch = below;
      }
    }) as never;
    const { result, requests } = await withHttp([textCompletion("Certo.")], () => runTurn(turnInput("C3", { monitor: fake })).then(() => null, (e: unknown) => e));
    assert.ok(result instanceof InstrumentDefect, String(result));
    assert.ok(result.failures.some((f) => f.layer === "monitor" && f.detail.includes("sem delegar")));
    assert.equal(monitorCalls, 1, "a repetição do Mastra depois do 500 foi bloqueada antes do monitor");
    assert.equal(requests.length, 0);
    assert.equal(result.record.execError, null);
  });

  it("contraste: erro de rede depois do monitor (chegou à sentinela) é EXEC_PROVIDER_ERROR, não defeito", async () => {
    const original = globalThis.fetch;
    let attempts = 0;
    globalThis.fetch = (async () => {
      attempts += 1;
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    try {
      const outcome = await runAttempt(turnInput("C3"), 1);
      assert.deepEqual(outcome.record.instrumentFailures, []);
      assert.equal(outcome.record.execError?.code, "EXEC_PROVIDER_ERROR");
      assert.ok(attempts >= 1);
    } finally {
      globalThis.fetch = original;
    }
  });
});
