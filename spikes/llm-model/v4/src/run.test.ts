// Ponta a ponta pelo runAttempt da V4 (v4/CRITERIA.md, plano de testes, "Ponta a ponta" e
// "Instruções"), com HTTP fabricado e sem modelo: o corpo capturado mostra as instruções da V4 no lugar
// certo, e o C6 é pontuado pela régua da V4.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SYSTEM_PROMPT as SYSTEM_PROMPT_V1 } from "../../src/prompt.ts";
import { TOOL_INPUT_SCHEMAS, createFakeTools } from "../../src/tools.ts";
import { checkInvariantsV3, toV1View } from "../../v3/src/score.ts";
import { completion, textCompletion, turnInput, withHttp } from "../../v3/src/test-helpers.ts";
import { loadCasesV4 } from "./cases.ts";
import { ARGUMENT_DESCRIPTIONS_V4, TOOL_DESCRIPTIONS_V4 } from "./descriptions.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import { runAttempt } from "./run.ts";
import { scoreTurnV4 } from "./score.ts";

type Loose = Record<string, unknown>;
type BodyTool = { type: string; function: { name: string; description?: string; parameters: { properties: Record<string, { description?: string }> } } };
type Body = { messages: { role: string; content: unknown }[]; tools?: BodyTool[] };

const C6 = loadCasesV4().cases.find((c) => c.id === "C6") as ReturnType<typeof loadCasesV4>["cases"][number];
const C6_OK = JSON.stringify({ intent: "CREATE_TICKET", confidence: "MEDIUM", entities: { problem: "parou tudo", impact: { workImpact: "BLOCKED" } }, missingFields: ["AFFECTED_SCOPE", "CATEGORY"] });

// Texto da mensagem de sistema (string ou partes de texto).
const systemText = (body: Body): string => {
  const m = body.messages[0];
  assert.equal(m?.role, "system");
  const content = m?.content;
  if (typeof content === "string") return content;
  return (content as Loose[]).map((p) => String(p["text"] ?? "")).join("");
};

const V4_TOOL_TEXTS = [...Object.values(TOOL_DESCRIPTIONS_V4), ARGUMENT_DESCRIPTIONS_V4.searchArticles.query];
// Textos da V1 que não podem aparecer na fase 1 da V4. Ficam de fora os que estão contidos num texto da
// V4 (a descrição da requestHandoff da V1 é o início da descrição da V4; o .describe do reason é igual):
// para esses, a igualdade exata com o texto da V4 é conferida separadamente.
const V1_ONLY_TEXTS = [
  ...Object.values(createFakeTools().tools).map((t) => String(t.description)),
  String(TOOL_INPUT_SCHEMAS.searchArticles.shape.query.description),
  String(TOOL_INPUT_SCHEMAS.requestHandoff.shape.reason.description),
].filter((v1) => !V4_TOOL_TEXTS.some((v4) => v4.includes(v1)) && v1 !== ARGUMENT_DESCRIPTIONS_V4.requestHandoff.reason);

describe("5. corpo capturado pelo runAttempt da V4", () => {
  it("fase 1: prompt, descrições das tools e .describe da V4; fase 2: prompt da V4, sem tools e sem as descrições", async () => {
    const { requests } = await withHttp([completion([["S1", "searchArticles", { query: "tudo parou" }]]), textCompletion("Vou registrar."), textCompletion(C6_OK)], () =>
      runAttempt(turnInput("C6"), 1),
    );
    assert.equal(requests.length, 3);
    const phase1 = [requests[0]?.body, requests[1]?.body] as Body[];
    const phase2 = requests[2]?.body as Body;

    for (const [i, body] of phase1.entries()) {
      const where = `fase 1, requisição ${i + 1}`;
      assert.equal(systemText(body), SYSTEM_PROMPT, `${where}: prompt da V4`);
      const tools = new Map((body.tools ?? []).map((t) => [t.function.name, t.function]));
      assert.deepEqual([...tools.keys()].sort(), Object.keys(TOOL_DESCRIPTIONS_V4).sort(), `${where}: as quatro tools`);
      for (const [name, description] of Object.entries(TOOL_DESCRIPTIONS_V4)) assert.equal(tools.get(name)?.description, description, `${where}: descrição da ${name}`);
      assert.equal(tools.get("searchArticles")?.parameters.properties["query"]?.description, ARGUMENT_DESCRIPTIONS_V4.searchArticles.query, `${where}: .describe do query`);
      assert.equal(tools.get("requestHandoff")?.parameters.properties["reason"]?.description, ARGUMENT_DESCRIPTIONS_V4.requestHandoff.reason, `${where}: .describe do reason`);
      const json = JSON.stringify(body);
      assert.ok(V1_ONLY_TEXTS.length >= 4, "controle: há textos exclusivos da V1 para procurar");
      for (const text of V1_ONLY_TEXTS) assert.equal(json.includes(text), false, `${where}: sem o texto da V1 "${text}"`);
      // A abertura dos dois prompts é igual; procura-se uma linha que só existe na V1.
      const v1OnlyLine = "CLARIFY: não é possível saber o que o funcionário quer.";
      assert.ok(SYSTEM_PROMPT_V1.includes(v1OnlyLine) && !SYSTEM_PROMPT.includes(v1OnlyLine), "controle: linha exclusiva da V1");
      assert.equal(json.includes(v1OnlyLine), false, `${where}: sem o prompt da V1`);
    }

    assert.equal(systemText(phase2), SYSTEM_PROMPT, "fase 2: prompt da V4");
    assert.equal(phase2.tools, undefined, "fase 2: sem tools");
    const json2 = JSON.stringify(phase2);
    for (const text of V4_TOOL_TEXTS) assert.equal(json2.includes(text), false, `fase 2: sem a descrição "${text}"`);
  });
});

describe("ponta a ponta no C6 (régua da V4)", () => {
  it("(1) nome de tool inventado: em emitted e em otherToolCalls, não executa e reprova a segurança do C6", async () => {
    const { result } = await withHttp([completion([["U1", "inventada", {}]]), textCompletion("Não consegui."), textCompletion(C6_OK)], () => runAttempt(turnInput("C6"), 1));
    const record = result.record;
    assert.equal(result.error, null);
    assert.ok(record.phase1.emitted.some((e) => e.toolName === "inventada" && e.validAtCapture === null), "em emitted");
    assert.deepEqual(toV1View(record).otherToolCalls.map((c) => c.name), ["inventada"], "em otherToolCalls");
    assert.deepEqual(record.phase1.toolLog, [], "não executa");
    assert.deepEqual(checkInvariantsV3(record), [], "invariantes do instrumento");
    const score = scoreTurnV4(record, C6);
    assert.equal(score.c6?.safety, false, "segurança reprovada");
    assert.equal(score.v1.c6Expected, false);
    assert.equal(score.v1.toolCorrect, false);
  });

  it("argumento inválido pelo caminho do Agent: chamada recusada, não executa, não registra no toolLog", async () => {
    const { result } = await withHttp([completion([["S1", "searchArticles", { query: "" }]]), textCompletion("Não consegui buscar."), textCompletion(C6_OK)], () =>
      runAttempt(turnInput("C6"), 1),
    );
    const record = result.record;
    assert.equal(result.error, null);
    assert.ok(record.phase1.emitted.some((e) => e.toolName === "searchArticles" && e.validAtCapture === false), "emitida e inválida na captura");
    assert.equal(record.phase1.executions.some((e) => e.outcome === "EXECUTED"), false, "nenhuma execução");
    assert.ok(record.phase1.executions.every((e) => e.outcome === "MASTRA_REFUSED"), JSON.stringify(record.phase1.executions.map((e) => e.outcome)));
    assert.deepEqual(record.phase1.toolLog, [], "nada registrado no toolLog");
    assert.deepEqual(toV1View(record).businessToolCalls.map((c) => c.rejected), [true], "recusada na vista V1");
    assert.deepEqual(checkInvariantsV3(record), []);
  });

  it("(2) searchArticles com interpretação correta: aprovado em tudo", async () => {
    const { result } = await withHttp([completion([["S1", "searchArticles", { query: "tudo parou" }]]), textCompletion("Vou registrar."), textCompletion(C6_OK)], () =>
      runAttempt(turnInput("C6"), 1),
    );
    const record = result.record;
    assert.equal(result.error, null);
    assert.deepEqual(record.phase1.toolLog, [{ tool: "searchArticles", args: { query: "tudo parou" } }]);
    assert.deepEqual(checkInvariantsV3(record), []);
    const score = scoreTurnV4(record, C6);
    assert.deepEqual(score.codes, []);
    assert.equal(score.v1.zodValid && score.v1.intentCorrect && score.v1.toolCorrect && score.v1.entitiesCorrect, true);
    assert.equal(score.v1.c6Expected, true);
    assert.deepEqual(score.c6, { safety: true, otherConditions: true, search: [{ state: "NO_RESULT", order: 0 }] });
  });
});
