// O que o ctx.input contém nos hooks do Mastra 1.81.0 para uma entrada coagível: cru ou coagido?
// Base da reconciliação (v2/CRITERIA.md, "Reconciliação"): o esperado é a forma coagida
// (validateToolInput(schema, cru).data), comparada em JSON canônico.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Agent } from "@mastra/core/agent";
import { noopLogger } from "@mastra/core/logger";
import { createTool, validateToolInput } from "@mastra/core/tools";

import { interpretationSchema } from "../../src/schema.ts";
import { TOOL_INPUT_SCHEMAS, createFakeTools } from "../../src/tools.ts";
import { call, scripted, toolStep, VALID } from "./test-helpers.ts";

async function observe(toolName: string, raw: unknown) {
  const seen: Record<string, unknown> = {};
  const { tools, calls: toolLog } = createFakeTools();
  const submit = createTool({
    id: "submitInterpretation",
    description: "x",
    inputSchema: interpretationSchema,
    execute: async (input) => {
      seen["execute"] = structuredClone(input);
      return { status: "ACCEPTED" };
    },
  });
  const { model } = scripted([toolStep(call(toolName, raw, "X1"))]);
  const agent = new Agent({ id: "h", name: "h", instructions: "h", model, tools: { ...tools, submitInterpretation: submit } });
  agent.__setLogger(noopLogger);
  await agent.generate("oi", {
    maxSteps: 1,
    hooks: {
      beforeToolCall: (ctx: { input: unknown }) => {
        seen["before"] = structuredClone(ctx.input);
      },
      afterToolCall: (ctx: { input: unknown }) => {
        seen["after"] = structuredClone(ctx.input);
      },
    },
  } as never);
  if (toolLog.length > 0) seen["execute"] = toolLog[0]?.args;
  return seen;
}

describe("ctx.input nos hooks, com entrada coagível pelo Mastra", () => {
  it("tool de negócio: searchArticles com campo extra nulo (o Mastra remove o nulo)", async () => {
    const raw = { query: "vpn", extra: null };
    const coerced = (validateToolInput(TOOL_INPUT_SCHEMAS.searchArticles as never, raw) as { data: unknown }).data;
    const seen = await observe("searchArticles", raw);
    console.log("  searchArticles:", JSON.stringify({ cru: raw, coagido: coerced, ...seen }));
    assert.deepEqual(coerced, { query: "vpn" });
    assert.deepEqual(seen["before"], raw, "beforeToolCall vê o CRU");
    assert.deepEqual(seen["after"], raw, "afterToolCall vê o CRU");
    assert.deepEqual(seen["execute"], coerced, "o execute (e o toolLog) recebe o COAGIDO");
  });

  it("submitInterpretation com entities em texto JSON (o Mastra converte em objeto)", async () => {
    const raw = { ...VALID.C3, entities: "{}" };
    const coerced = (validateToolInput(interpretationSchema as never, raw) as { data: unknown }).data;
    const seen = await observe("submitInterpretation", raw);
    console.log("  submitInterpretation:", JSON.stringify({ cru: raw, coagido: coerced, ...seen }));
    assert.deepEqual(coerced, VALID.C3);
    assert.deepEqual(seen["before"], raw, "beforeToolCall vê o CRU");
    assert.deepEqual(seen["after"], raw, "afterToolCall vê o CRU");
    assert.deepEqual(seen["execute"], coerced, "o execute recebe o COAGIDO");
  });
});
