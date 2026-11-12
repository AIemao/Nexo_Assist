// Invariantes conferidas DENTRO do runTurn, logo após cada tentativa e antes de qualquer espera ou
// nova tentativa (InstrumentDefect), sem mudar a semântica do 429, do QuotaExhausted e do registro.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MastraLanguageModelV2Mock } from "@mastra/core/test-utils/llm-mock";

import type { InvariantViolation, TurnRecordV2 } from "./record.ts";
import { InstrumentDefect, runModel, runTurn } from "./run.ts";
import { checkInvariants } from "./score.ts";
import { VALID, call, cases, toolStep, turnInput } from "./test-helpers.ts";

type MockConfig = ConstructorParameters<typeof MastraLanguageModelV2Mock>[0];

// Erro de API no formato do AI SDK (como no run.test.ts da V1).
const rateLimitError = (message: string, retryAfter: string) =>
  Object.assign(new Error(message), { name: "AI_APICallError", statusCode: 429, responseHeaders: { "retry-after": retryAfter }, responseBody: message });

// Dublê com roteiro de funções: cada doGenerate executa a próxima (pode lançar).
function scriptedFns(steps: (() => unknown)[]) {
  const state = { generations: 0 };
  const model = new MastraLanguageModelV2Mock({
    doGenerate: (async () => {
      state.generations += 1;
      const step = steps[state.generations - 1];
      if (step === undefined) throw new Error("geração fora do roteiro");
      return step();
    }) as unknown as MockConfig["doGenerate"],
  });
  return { model, state };
}

const submit = (id: string) => () => toolStep(call("submitInterpretation", VALID.C3, id));
const throw429 = () => {
  throw rateLimitError("Rate limit reached: tokens per minute (TPM)", "1");
};
// Verificador fabricado: acusa violação nos registros de tentativas que terminaram em 429.
const flags429: (r: TurnRecordV2) => InvariantViolation[] = (r) =>
  r.execError?.code === "EXEC_RATE_LIMIT" ? [{ invariant: "I4", detail: "fabricada na tentativa com 429" }] : [];

describe("invariantes dentro do runTurn", () => {
  it("tentativa 1 com violação E HTTP 429: um único runAttempt, nenhuma espera, rodada abortada, registro com a violação", async () => {
    // Aquecimento conclui; o primeiro turno avaliado (C1, repetição 1) recebe 429 e viola uma invariante.
    const { model, state } = scriptedFns([submit("W"), throw429, submit("NUNCA")]);
    const started = performance.now();
    const round = await runModel({ model: model as never, modelLabel: "dublê", provider: "mock", allowedHosts: [], cases, invariantCheck: flags429 });
    const elapsed = performance.now() - started;
    assert.equal(state.generations, 2, "aquecimento + uma tentativa; nenhuma nova tentativa");
    assert.ok(elapsed < 900, `sem a espera do Retry-After de 1 s (levou ${Math.round(elapsed)} ms)`);
    assert.deepEqual(round.aborted, { at: "C1, repetição 1", violations: [{ invariant: "I4", detail: "fabricada na tentativa com 429" }] });
    assert.equal(round.records.length, 1);
    const record = round.records[0] as TurnRecordV2;
    assert.equal(record.execError?.code, "EXEC_RATE_LIMIT");
    assert.equal(record.attempts, 1);
    assert.deepEqual(record.previousAttempts, []);
    assert.deepEqual(record.rateLimits, [], "a violação é conferida antes de registrar a espera");
  });

  it("violação na tentativa 2, depois de um 429 sem violação: InstrumentDefect com o registro e a tentativa anterior", async () => {
    const { model, state } = scriptedFns([throw429, submit("S1")]);
    const flagsAttempt2: (r: TurnRecordV2) => InvariantViolation[] = (r) => (r.attempts === 2 ? [{ invariant: "I2", detail: "fabricada na tentativa 2" }] : []);
    await assert.rejects(runTurn(turnInput("C3", model), flagsAttempt2), (error: unknown) => {
      assert.ok(error instanceof InstrumentDefect);
      assert.deepEqual(error.violations, [{ invariant: "I2", detail: "fabricada na tentativa 2" }]);
      assert.equal(error.record.attempts, 2);
      assert.equal(error.record.previousAttempts.length, 1);
      assert.equal(error.record.previousAttempts[0]?.error.code, "EXEC_RATE_LIMIT");
      assert.equal(error.record.rateLimits.length, 1);
      return true;
    });
    assert.equal(state.generations, 2);
  });

  it("429 sem violação: nova tentativa como antes (espera o Retry-After, conclui na tentativa 2)", async () => {
    const { model, state } = scriptedFns([throw429, submit("S1")]);
    const started = performance.now();
    const record = await runTurn(turnInput("C3", model));
    assert.ok(performance.now() - started >= 950, "esperou o Retry-After de 1 s");
    assert.equal(state.generations, 2);
    assert.equal(record.status, "completed");
    assert.equal(record.attempts, 2);
    assert.equal(record.rateLimits.length, 1);
    assert.equal(record.rateLimits[0]?.waitSeconds, 1);
    assert.equal(record.previousAttempts.length, 1);
    assert.deepEqual(checkInvariants(record), []);
  });

  it("cota diária esgotada sem violação: QuotaExhausted como antes (turnos restantes como EXEC_QUOTA, sem aborto)", async () => {
    const { model, state } = scriptedFns([submit("W"), () => { throw rateLimitError("Rate limit reached: tokens per day (TPD)", "3600"); }]);
    const round = await runModel({ model: model as never, modelLabel: "dublê", provider: "mock", allowedHosts: [], cases });
    assert.equal(round.aborted, null);
    assert.equal(round.records.length, 18);
    assert.ok(round.records.every((r) => r.execError?.code === "EXEC_QUOTA"));
    assert.equal(state.generations, 2, "nenhuma chamada depois da cota esgotada");
  });
});
