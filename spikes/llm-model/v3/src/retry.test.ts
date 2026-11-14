// Novas tentativas, cota diária e orçamento de tempo compartilhado (v3/CRITERIA.md, "Configuração",
// "Novas tentativas"; plano de testes, "Execução, tempo e monitor"). HTTP fabricado.
// Observação: em 429 e 500 o Mastra repete a requisição duas vezes por conta própria, medido na V2
// (mastra-behavior.test.ts); por isso cada 429 abaixo vem três vezes. Com Retry-After 0, as três
// requisições saem em ~0, ~3 e ~6 s (medido na V3).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runModel, runTurn } from "./run.ts";
import { checkInvariantsV3 } from "./score.ts";
import { OLLAMA, OLLAMA_HOST, VALID, cases, delayed, error429, textCompletion, turnInput, withHttp } from "./test-helpers.ts";

const valid = JSON.stringify(VALID.C3);

describe("429 e cota diária", () => {
  it("429 na fase 2: o turno inteiro é repetido; a tentativa anterior guarda as duas fases e passa pelas invariantes", async () => {
    const { result, requests } = await withHttp([textCompletion("Certo."), error429(), error429(), error429(), textCompletion("Certo."), textCompletion(valid)], () => runTurn(turnInput("C3")));
    assert.equal(requests.length, 6, "tentativa 1 (fase 1 + três 429 da fase 2) e tentativa 2 (fase 1 + fase 2)");
    assert.equal(result.status, "completed");
    assert.equal(result.attempts, 2);
    assert.equal(result.rateLimits.length, 1);
    const previous = result.previousAttempts[0];
    assert.equal(previous?.phase1.status, "completed");
    assert.equal(previous?.phase2?.status, "execution_error");
    assert.equal(previous?.execError?.code, "EXEC_RATE_LIMIT");
    assert.deepEqual(checkInvariantsV3(result), []);
  });

  it("cota diária esgotada: terminal; turnos restantes não executados, sem requisição", async () => {
    // Retry-After 0: com 3600, o Mastra esperaria até 30 s entre as próprias repetições.
    const daily = () => error429("0", "Rate limit reached: tokens per day (TPD)");
    const { result, requests } = await withHttp([textCompletion("Olá!"), textCompletion(valid), daily(), daily(), daily()], () =>
      runModel({ model: OLLAMA.config, modelLabel: OLLAMA.label, provider: "ollama", allowedHosts: [OLLAMA_HOST], cases }),
    );
    assert.equal(result.aborted, null);
    assert.equal(result.records.length, 18);
    assert.ok(result.records.every((r) => r.execError?.code === "EXEC_QUOTA"));
    assert.equal(requests.length, 5, "aquecimento (2) + as três requisições do primeiro turno; nenhuma depois");
  });
});

describe("tempo limite: 180 s por tentativa, compartilhados pelas duas fases", () => {
  it("a fase 1 consome parte do orçamento e a fase 2 recebe o mesmo sinal (não reinicia): estouro na fase 2 → EXEC_TIMEOUT", async () => {
    const { result } = await withHttp([delayed(400, textCompletion("Certo.")), delayed(400, textCompletion(valid))], () => runTurn(turnInput("C3", { timeoutMs: 600 })));
    assert.equal(result.phase1.status, "completed");
    assert.equal(result.phase2?.status, "execution_error");
    assert.equal(result.execError?.code, "EXEC_TIMEOUT");
    assert.equal(result.phase2?.finishReason, "aborted", "o Mastra devolve finishReason aborted, sem lançar");
  });

  it("estouro na fase 1: EXEC_TIMEOUT, e a fase 2 não roda", async () => {
    const { result, requests } = await withHttp([delayed(800, textCompletion("Certo.")), textCompletion(valid)], () => runTurn(turnInput("C3", { timeoutMs: 300 })));
    assert.equal(requests.length, 1);
    assert.equal(result.execError?.code, "EXEC_TIMEOUT");
    assert.equal(result.phase2, null);
    assert.deepEqual(checkInvariantsV3(result), []);
  });

  it("controle: com orçamento suficiente para as duas fases, o turno conclui", async () => {
    const { result } = await withHttp([delayed(400, textCompletion("Certo.")), delayed(400, textCompletion(valid))], () => runTurn(turnInput("C3", { timeoutMs: 1500 })));
    assert.equal(result.status, "completed");
  });

  it("nova tentativa por 429 começa um orçamento novo", async () => {
    // Tentativa 1: ~1 s na fase 1 + três 429 na fase 2 (~6 s do Mastra) ≈ 7 s < 9 s. Espera de 1 s.
    // Tentativa 2: 2,5 s + 2,5 s = 5 s < 9 s. Com orçamento compartilhado entre tentativas, a
    // tentativa 2 terminaria em ≈ 13 s desde o início (> 9 s) e daria EXEC_TIMEOUT.
    const { result } = await withHttp(
      [delayed(1000, textCompletion("Certo.")), error429(), error429(), error429(), delayed(2500, textCompletion("Certo.")), delayed(2500, textCompletion(valid))],
      () => runTurn(turnInput("C3", { timeoutMs: 9000 })),
    );
    assert.equal(result.attempts, 2);
    assert.equal(result.status, "completed", JSON.stringify(result.execError));
  });
});
