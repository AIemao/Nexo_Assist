// Tools da V4 (v4/CRITERIA.md, "Ajustes da implementação (Etapa 2B)", exceção controlada 3; plano de
// testes, "Instruções"): diferença mínima em relação à V1, comportamento, schemas da V1 intactos,
// instâncias independentes e schemas V1 × V4 iguais fora das descrições.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import { TOOL_INPUT_SCHEMAS, createFakeTools } from "../../src/tools.ts";
import { ARGUMENT_DESCRIPTIONS_V4, TOOL_DESCRIPTIONS_V4 } from "./descriptions.ts";
import { TOOL_INPUT_SCHEMAS_V4, createFakeToolsV4 } from "./tools.ts";

type ToolName = keyof typeof TOOL_INPUT_SCHEMAS;
type Loose = Record<string, unknown>;
const NAMES = Object.keys(TOOL_INPUT_SCHEMAS) as ToolName[];
const V1_QUERY = "Palavras-chave da dúvida do funcionário.";
const V1_REASON = "Motivo curto do pedido.";

const exec = (tool: unknown, input: unknown) => (tool as { execute: (i: unknown, c: unknown) => Promise<unknown> }).execute(input, {});
const isValidationError = (value: unknown) => typeof value === "object" && value !== null && (value as Loose)["error"] === true;

// Remove só a palavra-chave "description" (metadado) dos nós do JSON Schema. Dentro de "properties",
// as chaves são nomes de campo: a propriedade de entrada chamada "description" (proposeTicketDraft)
// fica, e o schema dela é tratado como qualquer outro nó.
function stripDescriptions(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripDescriptions);
  if (typeof node !== "object" || node === null) return node;
  const out: Loose = {};
  for (const [key, value] of Object.entries(node as Loose)) {
    if (key === "description" && typeof value === "string") continue;
    if (key === "properties" && typeof value === "object" && value !== null) {
      out[key] = Object.fromEntries(Object.entries(value as Loose).map(([field, schema]) => [field, stripDescriptions(schema)]));
      continue;
    }
    out[key] = stripDescriptions(value);
  }
  return out;
}

describe("1. diferença mínima: só description e inputSchema", () => {
  it("as demais propriedades próprias são iguais às de uma instância nova da V1", () => {
    const v1 = createFakeTools().tools as unknown as Record<ToolName, Loose>;
    const v4 = createFakeToolsV4().tools as unknown as Record<ToolName, Loose>;
    for (const name of NAMES) {
      assert.deepEqual(Object.keys(v4[name]).sort(), Object.keys(v1[name]).sort(), `${name}: mesmas chaves`);
      for (const key of Object.keys(v1[name])) {
        if (key === "description" || key === "inputSchema") continue;
        const a = v1[name][key];
        const b = v4[name][key];
        if (typeof a === "function") {
          // O execute é um envoltório por instância: compara-se o código, e o comportamento no item 2.
          assert.equal(typeof b, "function", `${name}.${key}`);
          assert.equal(String(b), String(a), `${name}.${key}: mesmo código`);
        } else {
          assert.deepEqual(b, a, `${name}.${key}`);
        }
      }
      assert.equal(v4[name]["description"], TOOL_DESCRIPTIONS_V4[name], `${name}: descrição da V4`);
      assert.equal(v4[name]["inputSchema"], TOOL_INPUT_SCHEMAS_V4[name], `${name}: schema da V4`);
      assert.notEqual(v1[name]["description"], v4[name]["description"], `${name}: a descrição mudou`);
    }
  });
});

describe("2. comportamento do execute", () => {
  const cases: [ToolName, unknown, unknown][] = [
    ["searchArticles", { query: "horario" }, { query: "" }],
    ["listMyTickets", {}, { extra: 1 }],
    ["proposeTicketDraft", { title: "t", description: "d", type: "INC", category: "OTHER", impactAssessment: { affectedScope: "SELF", workImpact: "NONE", commitmentRisk: "NO" } }, { title: "t" }],
    ["requestHandoff", {}, { reason: "" }],
  ];
  for (const [name, valid, invalid] of cases) {
    it(`${name}: válida executa e registra uma vez; inválida é recusada sem executar nem registrar; igual à V1`, async () => {
      const v1 = createFakeTools();
      const v4 = createFakeToolsV4();
      const okV1 = await exec(v1.tools[name], valid);
      const okV4 = await exec(v4.tools[name], valid);
      assert.deepEqual(okV4, okV1, "mesmo resultado da V1");
      assert.equal(isValidationError(okV4), false);
      assert.deepEqual(v4.calls, [{ tool: name, args: valid }], "registrada exatamente uma vez");
      const badV4 = await exec(v4.tools[name], invalid);
      const badV1 = await exec(v1.tools[name], invalid);
      assert.equal(isValidationError(badV4), true, "recusada");
      assert.equal(isValidationError(badV1), true, "recusada também na V1");
      assert.equal(v4.calls.length, 1, "a recusa não executa nem registra");
    });
  }
});

describe("3. schemas da V1 intactos", () => {
  it("depois de criar as tools da V4, o TOOL_INPUT_SCHEMAS e uma instância nova da V1 seguem com os textos da V1", () => {
    createFakeToolsV4();
    createFakeToolsV4();
    assert.equal(TOOL_INPUT_SCHEMAS.searchArticles.shape.query.description, V1_QUERY);
    assert.equal(TOOL_INPUT_SCHEMAS.requestHandoff.shape.reason.description, V1_REASON);
    const v1 = createFakeTools().tools;
    assert.equal(v1.searchArticles.inputSchema, TOOL_INPUT_SCHEMAS.searchArticles);
    assert.notEqual(v1.searchArticles.description, TOOL_DESCRIPTIONS_V4.searchArticles);
    assert.equal(TOOL_INPUT_SCHEMAS_V4.searchArticles.shape.query.description, ARGUMENT_DESCRIPTIONS_V4.searchArticles.query);
    assert.equal(TOOL_INPUT_SCHEMAS_V4.requestHandoff.shape.reason.description, ARGUMENT_DESCRIPTIONS_V4.requestHandoff.reason);
  });
});

describe("4. instâncias independentes", () => {
  it("duas chamadas a createFakeToolsV4() não compartilham toolLog nem instâncias", async () => {
    const a = createFakeToolsV4();
    const b = createFakeToolsV4();
    assert.notEqual(a.tools.searchArticles, b.tools.searchArticles);
    await exec(a.tools.searchArticles, { query: "vpn" });
    assert.equal(a.calls.length, 1);
    assert.equal(b.calls.length, 0);
  });
});

describe("6. schemas V1 × V4: iguais fora da palavra-chave description", () => {
  it("z.toJSONSchema igual nas quatro tools depois de remover só os metadados description", () => {
    for (const name of NAMES) {
      const v1 = z.toJSONSchema(TOOL_INPUT_SCHEMAS[name]);
      const v4 = z.toJSONSchema(TOOL_INPUT_SCHEMAS_V4[name]);
      assert.deepEqual(stripDescriptions(v4), stripDescriptions(v1), name);
    }
  });

  it("controles: a propriedade de entrada 'description' da proposeTicketDraft fica; as descrições da V4 estão no JSON Schema", () => {
    const stripped = stripDescriptions(z.toJSONSchema(TOOL_INPUT_SCHEMAS_V4.proposeTicketDraft)) as { properties: Loose; required: string[] };
    assert.ok(Object.hasOwn(stripped.properties, "description"), "propriedade de entrada preservada");
    assert.ok(stripped.required.includes("description"));
    const search = z.toJSONSchema(TOOL_INPUT_SCHEMAS_V4.searchArticles) as unknown as { properties: { query: { description: string } } };
    assert.equal(search.properties.query.description, ARGUMENT_DESCRIPTIONS_V4.searchArticles.query);
  });
});
