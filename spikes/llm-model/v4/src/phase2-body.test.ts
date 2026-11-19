// Corpo da requisição da fase 2 (v4/CRITERIA.md, "Ajustes da implementação (Etapa 2A)", verificação 0).
// A regra 11 e a frase do prompt "com as chamadas de ferramenta e os resultados" dependem de a fase 2
// receber, além da chamada da tool, a mensagem com o RESULTADO dela. Os testes da V3 conferem só os
// papéis das mensagens; este confere o conteúdo, pelo runAttempt da V3 (HTTP fabricado, sem modelo).
// Na Etapa 2B, o mesmo teste passa a rodar também pelo runAttempt da V4.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runAttempt } from "../../v3/src/run.ts";
import { completion, textCompletion, turnInput, withHttp } from "../../v3/src/test-helpers.ts";
import { runAttempt as runAttemptV4 } from "./run.ts";

type Message = { role: string; content?: unknown; tool_calls?: { id: string; function: { name: string; arguments: string } }[]; tool_call_id?: string };

const FINAL_TEXT = "TEXTO-FINAL-DO-ATENDIMENTO-XYZ";
const INTERPRETATION = JSON.stringify({ intent: "ANSWER_KB", confidence: "HIGH", entities: {}, missingFields: [] });

describe("corpo da fase 2 pelo runAttempt da V3", () => {
  it("(a) tool call no assistant; (b) mensagem tool com o mesmo tool_call_id e o resultado; (c) sem o texto final; sem tools", async () => {
    const { requests } = await withHttp(
      [completion([["S1", "searchArticles", { query: "horario" }]]), textCompletion(FINAL_TEXT), textCompletion(INTERPRETATION)],
      () => runAttempt(turnInput("C1"), 1),
    );
    assert.equal(requests.length, 3, "duas requisições da fase 1 e uma da fase 2");
    const prefix = (requests[0]?.body["messages"] as unknown[]).length;
    const body = requests[2]?.body as { messages: Message[]; tools?: unknown };
    const tail = body.messages.slice(prefix);
    assert.deepEqual(
      tail.map((m) => m.role),
      ["assistant", "tool"],
    );

    // (a) A chamada da tool, na mensagem assistant.
    const call = tail[0]?.tool_calls?.[0];
    assert.equal(call?.id, "S1");
    assert.equal(call?.function.name, "searchArticles");
    assert.deepEqual(JSON.parse(call?.function.arguments ?? "null"), { query: "horario" });

    // (b) O resultado da tool, com o mesmo tool_call_id e conteúdo identificável (o artigo devolvido).
    assert.equal(tail[1]?.tool_call_id, "S1");
    assert.ok(JSON.stringify(tail[1]?.content).includes("ART-HORARIO"), "o resultado da busca chega à fase 2");

    // (c) O texto final do atendimento não vai para a fase 2.
    assert.equal(JSON.stringify(body).includes(FINAL_TEXT), false);

    // A fase 2 não recebe tools.
    assert.equal(body.tools, undefined);
  });
});

// Etapa 2B: a mesma verificação pelo runAttempt da V4 (as mesmas quatro asserções).
describe("corpo da fase 2 pelo runAttempt da V4", () => {
  it("(a) tool call no assistant; (b) mensagem tool com o mesmo tool_call_id e o resultado; (c) sem o texto final; sem tools", async () => {
    const { requests } = await withHttp(
      [completion([["S1", "searchArticles", { query: "horario" }]]), textCompletion(FINAL_TEXT), textCompletion(INTERPRETATION)],
      () => runAttemptV4(turnInput("C1"), 1),
    );
    assert.equal(requests.length, 3, "duas requisições da fase 1 e uma da fase 2");
    const prefix = (requests[0]?.body["messages"] as unknown[]).length;
    const body = requests[2]?.body as { messages: Message[]; tools?: unknown };
    const tail = body.messages.slice(prefix);
    assert.deepEqual(
      tail.map((m) => m.role),
      ["assistant", "tool"],
    );

    // (a) A chamada da tool, na mensagem assistant.
    const call = tail[0]?.tool_calls?.[0];
    assert.equal(call?.id, "S1");
    assert.equal(call?.function.name, "searchArticles");
    assert.deepEqual(JSON.parse(call?.function.arguments ?? "null"), { query: "horario" });

    // (b) O resultado da tool, com o mesmo tool_call_id e conteúdo identificável (o artigo devolvido).
    assert.equal(tail[1]?.tool_call_id, "S1");
    assert.ok(JSON.stringify(tail[1]?.content).includes("ART-HORARIO"), "o resultado da busca chega à fase 2");

    // (c) O texto final do atendimento não vai para a fase 2.
    assert.equal(JSON.stringify(body).includes(FINAL_TEXT), false);

    // A fase 2 não recebe tools.
    assert.equal(body.tools, undefined);
  });
});
