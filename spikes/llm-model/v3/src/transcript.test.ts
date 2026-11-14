// Transcrição e transcrição fiel (v3/CRITERIA.md, "Transcrição da fase 1 para a fase 2",
// "Transcrição fiel (I10)"; plano de testes, "Transcrição e transcrição fiel").
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EmittedCall } from "../../v2/src/record.ts";
import { runAttempt } from "./run.ts";
import { checkInvariantsV3 } from "./score.ts";
import { AMBIGUOUS_RESULTS, fidelityA, fidelityB, filterTranscript, transcriptSteps } from "./transcript.ts";
import { VALID, caseById, completion, textCompletion, turnInput, withHttp } from "./test-helpers.ts";

const tc = (id: string, name: string, input: unknown) => ({ type: "tool-call", toolCallId: id, toolName: name, input });
const tr = (id: string, name: string, value: unknown, type = "json") => ({ type: "tool-result", toolCallId: id, toolName: name, output: { type, value } });
const emit = (step: number, order: number, id: string | null, name: string, args: unknown): EmittedCall => ({ step, order, toolCallId: id, toolName: name, rawArgs: args, validAtCapture: true });

describe("filtro da transcrição", () => {
  it("remove raciocínio, exclui o texto final, mantém recusa de validação e resultado de tool desconhecida", () => {
    const messages = [
      { role: "assistant", content: [{ type: "reasoning", text: "SEGREDO" }, tc("S1", "searchArticles", { query: "" }), tc("U1", "inventada", {})] },
      { role: "tool", content: [tr("S1", "searchArticles", { error: true, message: "Tool input validation failed" }), tr("U1", "inventada", 'Tool "inventada" not found.', "error-text")] },
      { role: "assistant", content: [{ type: "reasoning", text: "SEGREDO" }, { type: "text", text: "Resposta final." }] },
    ];
    const t = filterTranscript(messages);
    assert.equal(t.length, 2);
    assert.equal(JSON.stringify(t).includes("SEGREDO"), false);
    assert.equal(JSON.stringify(t).includes("Resposta final"), false);
    assert.ok(JSON.stringify(t).includes("Tool input validation failed"));
    assert.ok(JSON.stringify(t).includes("not found"));
    assert.equal((t.at(-1) as { role: string }).role, "tool", "a conversa da fase 2 termina em tool");
  });

  it("fase 1 sem tool: transcrição vazia (a conversa da fase 2 termina na user)", () => {
    assert.deepEqual(filterTranscript([{ role: "assistant", content: [{ type: "text", text: "Olá!" }] }]), []);
    assert.deepEqual(filterTranscript([]), []);
  });

  it("texto intermediário com duas chamadas paralelas: a mensagem assistant é preservada inteira (só o raciocínio sai); a última assistant sem tool call sai", () => {
    const messages = [
      { role: "assistant", content: [{ type: "text", text: "Vou consultar duas coisas." }, { type: "reasoning", text: "SEGREDO" }, tc("A1", "searchArticles", { query: "vpn" }), tc("L1", "listMyTickets", {})] },
      { role: "tool", content: [tr("L1", "listMyTickets", { tickets: [] }), tr("A1", "searchArticles", { articles: [] })] },
      { role: "assistant", content: [{ type: "text", text: "Final." }] },
    ];
    const t = filterTranscript(messages) as { role: string; content: { type: string; text?: string }[] }[];
    assert.equal(t.length, 2);
    assert.deepEqual(t[0]?.content.map((p) => p.type), ["text", "tool-call", "tool-call"]);
    assert.equal(t[0]?.content[0]?.text, "Vou consultar duas coisas.");
    assert.equal(transcriptSteps(t)[0]?.calls.length, 2);
  });
});

describe("comparação A: captura da fase 1 × transcrição filtrada", () => {
  const parallel = [
    { role: "assistant", content: [tc("A1", "searchArticles", { query: "vpn" }), tc("L1", "listMyTickets", {})] },
    { role: "tool", content: [tr("L1", "listMyTickets", { tickets: [] }), tr("A1", "searchArticles", { articles: [] })] },
  ];
  const parallelEmitted = [emit(0, 0, "A1", "searchArticles", { query: "vpn" }), emit(0, 1, "L1", "listMyTickets", {})];

  it("positivo: duas chamadas paralelas com os resultados em ordem invertida → fiel, sem violação", () => {
    assert.deepEqual(fidelityA(parallelEmitted, parallel), { violations: [], diagnostics: [] });
  });

  it("positivo: ids duplicados no mesmo passo, correspondência correta → diagnóstico RESULT_ASSOCIATION_AMBIGUOUS_DUPLICATE_ID, sem violação", () => {
    const dup = [
      { role: "assistant", content: [tc("X", "searchArticles", { query: "vpn" }), tc("X", "searchArticles", { query: "email" })] },
      { role: "tool", content: [tr("X", "searchArticles", { a: 1 }), tr("X", "searchArticles", { a: 2 })] },
    ];
    const r = fidelityA([emit(0, 0, "X", "searchArticles", { query: "vpn" }), emit(0, 1, "X", "searchArticles", { query: "email" })], dup);
    assert.deepEqual(r.violations, []);
    assert.ok(r.diagnostics.some((d) => d.includes("modo alternativo")));
    assert.ok(r.diagnostics.some((d) => d.includes(AMBIGUOUS_RESULTS)));
  });

  it("positivo: id ausente num passo e presente nos outros → só aquele passo no modo alternativo", () => {
    const t = [
      { role: "assistant", content: [tc("L1", "listMyTickets", {})] },
      { role: "tool", content: [tr("L1", "listMyTickets", {})] },
      { role: "assistant", content: [tc("A1", "searchArticles", { query: "vpn" })] },
      { role: "tool", content: [tr("A1", "searchArticles", {})] },
    ];
    const r = fidelityA([emit(0, 0, "L1", "listMyTickets", {}), emit(1, 1, null, "searchArticles", { query: "vpn" })], t);
    assert.deepEqual(r.violations, []);
    assert.equal(r.diagnostics.filter((d) => d.includes("modo alternativo")).length, 1);
    assert.ok(r.diagnostics.every((d) => d.startsWith("A, passo 2")));
  });

  it("positivo: tool desconhecida emitida, com o resultado de erro na transcrição → sem violação", () => {
    const t = [
      { role: "assistant", content: [tc("U1", "inventada", { a: 1 })] },
      { role: "tool", content: [tr("U1", "inventada", 'Tool "inventada" not found.', "error-text")] },
    ];
    assert.deepEqual(fidelityA([emit(0, 0, "U1", "inventada", { a: 1 })], t).violations, []);
  });

  const negatives: [string, EmittedCall[], unknown[]][] = [
    ["id associado ao nome errado", [emit(0, 0, "A1", "listMyTickets", {}), emit(0, 1, "L1", "searchArticles", { query: "vpn" })], parallel],
    ["quantidade divergente", [emit(0, 0, "A1", "searchArticles", { query: "vpn" })], parallel],
    ["argumentos divergentes", [emit(0, 0, "A1", "searchArticles", { query: "outra" }), emit(0, 1, "L1", "listMyTickets", {})], parallel],
    [
      "resultado ausente (quantidade de resultados)",
      parallelEmitted,
      [parallel[0], { role: "tool", content: [tr("L1", "listMyTickets", {})] }],
    ],
    [
      "ordem de passos trocada",
      [emit(0, 0, "L1", "listMyTickets", {}), emit(1, 1, "A1", "searchArticles", { query: "vpn" })],
      [
        { role: "assistant", content: [tc("A1", "searchArticles", { query: "vpn" })] },
        { role: "tool", content: [tr("A1", "searchArticles", {})] },
        { role: "assistant", content: [tc("L1", "listMyTickets", {})] },
        { role: "tool", content: [tr("L1", "listMyTickets", {})] },
      ],
    ],
    ["tool desconhecida emitida e ausente da transcrição", [emit(0, 0, "U1", "inventada", { a: 1 })], []],
  ];
  for (const [name, emitted, transcript] of negatives) {
    it(`negativo: ${name} → violação`, () => {
      assert.ok(fidelityA(emitted, transcript).violations.length > 0);
    });
  }
});

describe("comparação B: transcrição filtrada × corpo da fase 2", () => {
  const transcript = [
    { role: "assistant", content: [tc("A1", "searchArticles", { query: "vpn" }), tc("L1", "listMyTickets", {})] },
    { role: "tool", content: [tr("A1", "searchArticles", { b: 2, a: 1 }), tr("L1", "listMyTickets", "texto livre", "text")] },
  ];
  const head = [{ role: "system", content: "s" }, { role: "user", content: "pedido" }];
  const body = (calls: { id: string; name: string; args: string }[], results: { id: string; content: string }[], extra: unknown[] = []) => [
    ...head,
    { role: "assistant", content: null, tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } })) },
    ...results.map((r) => ({ role: "tool", tool_call_id: r.id, content: r.content })),
    ...extra,
  ];
  const goodCalls = [{ id: "A1", name: "searchArticles", args: '{"query":"vpn"}' }, { id: "L1", name: "listMyTickets", args: "{}" }];
  const goodResults = [{ id: "L1", content: "texto livre" }, { id: "A1", content: '{"a":1,"b":2}' }];

  it("positivo: chaves dos resultados em outra ordem e resultado que não é JSON (comparado como string) → fiel", () => {
    assert.deepEqual(fidelityB(transcript, body(goodCalls, goodResults), 2), { violations: [], diagnostics: [] });
  });

  it("positivo: ids duplicados num passo com correspondência correta → diagnóstico, sem violação", () => {
    const t = [
      { role: "assistant", content: [tc("X", "searchArticles", { query: "a" }), tc("X", "searchArticles", { query: "b" })] },
      { role: "tool", content: [tr("X", "searchArticles", { r: 1 }), tr("X", "searchArticles", { r: 2 })] },
    ];
    const b = body([{ id: "X", name: "searchArticles", args: '{"query":"b"}' }, { id: "X", name: "searchArticles", args: '{"query":"a"}' }], [{ id: "X", content: '{"r":2}' }, { id: "X", content: '{"r":1}' }]);
    const r = fidelityB(t, b, 2);
    assert.deepEqual(r.violations, []);
    assert.ok(r.diagnostics.some((d) => d.includes(AMBIGUOUS_RESULTS)));
  });

  const negatives: [string, unknown[]][] = [
    ["id divergente", body([{ ...goodCalls[0]!, id: "ZZ" }, goodCalls[1]!], goodResults)],
    ["nome divergente", body([goodCalls[0]!, { ...goodCalls[1]!, name: "requestHandoff" }], goodResults)],
    ["argumento divergente", body([{ ...goodCalls[0]!, args: '{"query":"outra"}' }, goodCalls[1]!], goodResults)],
    ["resultado divergente", body(goodCalls, [goodResults[0]!, { id: "A1", content: '{"a":9}' }])],
    ["assistant sem tool_calls no sufixo", body(goodCalls, goodResults, [{ role: "assistant", content: "texto" }])],
    ["user inserida dentro do sufixo", body(goodCalls, goodResults, [{ role: "user", content: "intrusa" }])],
  ];
  for (const [name, b] of negatives) {
    it(`negativo: ${name} → violação`, () => {
      assert.ok(fidelityB(transcript, b, 2).violations.length > 0);
    });
  }

  it("negativo: a mensagem de índice N − 1 não é a user do funcionário → violação", () => {
    assert.ok(fidelityB(transcript, body(goodCalls, goodResults), 1).violations.some((v) => v.includes("N − 1")));
  });
});

describe("fronteira N pelo caminho real (model router, HTTP fabricado)", () => {
  it("C5 (histórico com mensagens de tool de um turno anterior): fiel, sem violação de invariante", async () => {
    const { result, requests } = await withHttp([completion([["H1", "requestHandoff", {}]]), textCompletion("Pronto."), textCompletion(JSON.stringify(VALID.C5))], () => runAttempt(turnInput("C5"), 1));
    const record = result.record;
    assert.equal(requests.length, 3);
    assert.deepEqual(record.fidelity, { violations: [], diagnostics: [] });
    assert.deepEqual(checkInvariantsV3(record), []);
    // Corpo da fase 2 = corpo da 1ª requisição da fase 1 + transcrição (assistant + tool).
    const first = (requests[0]?.body["messages"] as unknown[]).length;
    const phase2 = (requests[2]?.body["messages"] as { role: string }[]).map((m) => m.role);
    assert.deepEqual(phase2.slice(first), ["assistant", "tool"]);
  });

  it("histórico fabricado com uma mensagem tool de dois resultados (duas mensagens no corpo): fronteira correta", async () => {
    const base = caseById("C3");
    const fabricated = {
      ...base,
      history: [
        { role: "user" as const, content: "oi" },
        { role: "assistant" as const, content: "vou ver", toolCalls: [{ tool: "listMyTickets" as const, args: {}, result: { a: 1 } }, { tool: "searchArticles" as const, args: { query: "vpn" }, result: { b: 2 } }] },
      ],
    };
    const { result, requests } = await withHttp([completion([["L1", "listMyTickets", {}]]), textCompletion("Pronto."), textCompletion(JSON.stringify(VALID.C3))], () =>
      runAttempt(turnInput("C3", { testCase: fabricated as never }), 1),
    );
    const roles = (requests[0]?.body["messages"] as { role: string }[]).map((m) => m.role);
    assert.deepEqual(roles, ["system", "user", "assistant", "tool", "tool", "assistant", "user"], "dois resultados viram duas mensagens tool");
    assert.deepEqual(result.record.fidelity.violations, []);
    assert.deepEqual(checkInvariantsV3(result.record), []);
  });
});
