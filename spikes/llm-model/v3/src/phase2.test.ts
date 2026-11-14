// Fase 2, falhas e leitura crua (v3/CRITERIA.md, "Interpretação oficial", "Classificação das falhas
// da fase 2", "Segurança e registros"; plano de testes, "Fase 2, falhas e leitura crua").
// Caminho real do Ollama (model router) com respostas HTTP fabricadas; nenhum modelo real.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readInterpretation } from "./phase2.ts";
import { runAttempt, runJsonl } from "./run.ts";
import { checkInvariantsV3, scoreTurnV3 } from "./score.ts";
import { VALID, caseById, completion, error401, error500, textCompletion, turnInput, withHttp } from "./test-helpers.ts";

const valid = JSON.stringify(VALID.C3);
// Fase 1 só com texto (sem tool) seguida da resposta da fase 2.
const phase2Only = (phase2: unknown) => [textCompletion("Certo."), phase2];

describe("leitura crua da fase 2 (função pura)", () => {
  it("JSON.parse direto; vazio, inválido e finishReason length dão null", () => {
    assert.deepEqual(readInterpretation(valid, "stop"), { value: VALID.C3, parse: "OK" });
    assert.deepEqual(readInterpretation("", "stop"), { value: null, parse: "EMPTY" });
    assert.deepEqual(readInterpretation("```json\n{}\n```", "stop"), { value: null, parse: "INVALID_JSON" });
    assert.deepEqual(readInterpretation(valid, "length"), { value: null, parse: "LENGTH" });
  });
});

describe("leitura crua pelo caminho real, com a coluna do object do Mastra", () => {
  const matrix: [string, unknown, { parse: string; zod: boolean; object: boolean }][] = [
    ["JSON válido: válido nos dois", textCompletion(valid), { parse: "OK", zod: true, object: true }],
    ["cerca ```json: o Mastra aceita, o oficial não", textCompletion("```json\n" + valid + "\n```"), { parse: "INVALID_JSON", zod: false, object: true }],
    ["prosa + JSON: o Mastra aceita, o oficial não", textCompletion(`Segue: ${valid} Obrigado.`), { parse: "INVALID_JSON", zod: false, object: true }],
    ["JSON sem a última chave: o Mastra repara, o oficial não", textCompletion(valid.slice(0, -1)), { parse: "INVALID_JSON", zod: false, object: true }],
    ["campo extra: recusado nos dois", textCompletion(JSON.stringify({ ...VALID.C3, extra: 1 })), { parse: "OK", zod: false, object: false }],
    ["null em opcional: recusado nos dois", textCompletion(JSON.stringify({ ...VALID.C3, entities: { problem: null } })), { parse: "OK", zod: false, object: false }],
    ["texto vazio", textCompletion(""), { parse: "EMPTY", zod: false, object: false }],
    ["finishReason length com JSON aparentemente completo", textCompletion(valid, { finish: "length" }), { parse: "LENGTH", zod: false, object: false }],
  ];
  for (const [name, response, expected] of matrix) {
    it(name, async () => {
      const { result, requests } = await withHttp(phase2Only(response), () => runAttempt(turnInput("C3"), 1));
      const r = result.record;
      assert.equal(requests.length, 2);
      assert.equal(r.status, "completed", "errorStrategy warn: nenhuma exceção");
      assert.equal(r.phase2?.parse, expected.parse);
      assert.equal(r.phase2?.zodValid, expected.zod);
      assert.equal(r.phase2?.mastraObjectPresent, expected.object);
      assert.deepEqual(checkInvariantsV3(r), []);
      const codes = scoreTurnV3(r, caseById("C3")).codes;
      assert.equal(codes.includes("SEM_INVALID_INTERPRETATION"), !expected.zod);
      if (expected.parse === "LENGTH") assert.equal(r.phase2?.interpretationRaw, null, "interpretação oficial null");
    });
  }

  it("errorStrategy warn: com a validação do Mastra recusando, o text continua disponível", async () => {
    const extra = JSON.stringify({ ...VALID.C3, extra: 1 });
    const { result } = await withHttp(phase2Only(textCompletion(extra)), () => runAttempt(turnInput("C3"), 1));
    assert.equal(result.error, null);
    assert.equal(result.record.phase2?.text, extra);
    assert.equal(result.record.phase2?.mastraObjectPresent, false);
  });
});

describe("tool call na fase 2", () => {
  it("uma requisição só (maxSteps 1); nada executa; diagnóstico; SEM_INVALID_INTERPRETATION; nunca SEM_WRONG_TOOL", async () => {
    // C6: o esperado é nenhuma tool de negócio; a fase 1 não chama tool.
    const { result, requests } = await withHttp([textCompletion("Entendi."), completion([["X1", "listMyTickets", {}]])], () => runAttempt(turnInput("C6"), 1));
    const r = result.record;
    assert.equal(requests.length, 2, "maxSteps 1: nenhuma segunda requisição na fase 2");
    assert.deepEqual(r.phase2?.toolCalls, { count: 1, names: ["listMyTickets"] });
    assert.equal(r.phase2?.toolLogGrowth, 0);
    assert.equal(r.phase2?.parse, "EMPTY");
    assert.deepEqual(checkInvariantsV3(r), []);
    const codes = scoreTurnV3(r, caseById("C6")).codes;
    assert.ok(codes.includes("SEM_INVALID_INTERPRETATION"));
    assert.equal(codes.includes("SEM_WRONG_TOOL"), false);
  });
});

describe("requisição da fase 2", () => {
  it("só a mensagem de sistema e a conversa, sem texto injetado pelo Mastra", async () => {
    const { requests } = await withHttp([completion([["L1", "listMyTickets", {}]]), textCompletion("Pronto."), textCompletion(valid)], () => runAttempt(turnInput("C3"), 1));
    const phase1 = requests[0]?.body["messages"] as { role: string; content: unknown }[];
    const phase2 = requests[2]?.body["messages"] as { role: string; content: unknown }[];
    assert.deepEqual(phase2.slice(0, phase1.length), phase1, "o prefixo da fase 2 é o corpo da 1ª requisição da fase 1");
    assert.deepEqual(phase2.slice(phase1.length).map((m) => m.role), ["assistant", "tool"]);
    assert.equal(JSON.stringify(phase2).includes("Return your response as JSON"), false);
  });
});

describe("result.object com raciocínio (diagnóstico)", () => {
  it("marcador num valor do object: vazamento detectado e o marcador ausente do arquivo de resultados", async () => {
    const withThink = JSON.stringify({ ...VALID.C3, entities: { problem: "<think>raciocínio interno</think>ver chamados" } });
    const { result } = await withHttp(phase2Only(textCompletion(withThink)), () => runAttempt(turnInput("C3"), 1));
    const r = result.record;
    assert.equal(r.phase2?.mastraObjectPresent, true);
    assert.equal(r.phase2?.reasoning.leakedInObject, true);
    assert.ok(scoreTurnV3(r, caseById("C3")).codes.includes("SEM_REASONING_LEAK"));
    const file = runJsonl({ type: "run" } as never, [r]);
    assert.equal(file.includes("<think>"), false);
    assert.equal(file.includes("raciocínio interno"), false);
  });
});

describe("falhas de execução", () => {
  it("fase 1 em EXEC_* (tool seguida de 401): a fase 2 não roda; EXEC_PROVIDER_ERROR", async () => {
    const { result, requests } = await withHttp([completion([["L1", "listMyTickets", {}]]), error401], () => runAttempt(turnInput("C3"), 1));
    const r = result.record;
    assert.equal(requests.length, 2);
    assert.equal(r.phase2, null);
    assert.equal(r.phase2Invocations, 0);
    assert.equal(r.execError?.code, "EXEC_PROVIDER_ERROR");
    assert.deepEqual(checkInvariantsV3(r), []);
  });

  it("fase 2 com 401: EXEC_PROVIDER_ERROR", async () => {
    const { result } = await withHttp([textCompletion("Certo."), error401], () => runAttempt(turnInput("C3"), 1));
    assert.equal(result.record.phase2?.status, "execution_error");
    assert.equal(result.record.execError?.code, "EXEC_PROVIDER_ERROR");
    assert.deepEqual(checkInvariantsV3(result.record), []);
  });

  it("fase 2 com 500 persistente (novas tentativas internas do Mastra): EXEC_PROVIDER_ERROR; passos retry fora da I5", async () => {
    const { result, requests } = await withHttp([textCompletion("Certo."), error500, error500, error500], () => runAttempt(turnInput("C3"), 1));
    const r = result.record;
    assert.equal(requests.length, 4);
    assert.equal(r.execError?.code, "EXEC_PROVIDER_ERROR");
    assert.deepEqual(r.phase2?.calls.map((c) => c.finishReason), ["retry", "retry", "error"]);
    assert.deepEqual(checkInvariantsV3(r), []);
  });
});
