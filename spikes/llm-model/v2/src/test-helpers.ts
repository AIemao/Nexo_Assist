// Apoio aos testes da V2 (só testes): dublê roteirizado do Mastra, com contador de gerações.
import { readFileSync } from "node:fs";

import { MastraLanguageModelV2Mock } from "@mastra/core/test-utils/llm-mock";

import { casesFileSchema } from "../../src/cases-schema.ts";

type MockConfig = ConstructorParameters<typeof MastraLanguageModelV2Mock>[0];
export const USAGE = { inputTokens: 900, outputTokens: 20, totalTokens: 920 };

export const cases = casesFileSchema.parse(JSON.parse(readFileSync(new URL("../../cases.json", import.meta.url), "utf8"))).cases;
export const caseById = (id: string) => {
  const found = cases.find((c) => c.id === id);
  if (found === undefined) throw new Error(`caso ${id} ausente`);
  return found;
};

export const call = (toolName: string, input: unknown, toolCallId: string) => ({ type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) });
export const toolStep = (...calls: unknown[]) => ({ content: calls, finishReason: "tool-calls", usage: USAGE, warnings: [] });
export const textStep = (text: string) => ({ content: [{ type: "text", text }], finishReason: "stop", usage: USAGE, warnings: [] });
// Resposta de depois do roteiro: se aparecer, houve geração que não devia acontecer.
export const AFTER_SCRIPT = "GERAÇÃO FORA DO ROTEIRO";

// Dublê pelo doGenerate (o método que o Agent.generate usa no Mastra 1.81.0).
export function scripted(responses: unknown[]) {
  const state = { generations: 0 };
  const model = new MastraLanguageModelV2Mock({
    doGenerate: (async () => {
      state.generations += 1;
      return responses[state.generations - 1] ?? textStep(AFTER_SCRIPT);
    }) as unknown as MockConfig["doGenerate"],
  });
  return { model, state };
}

export const VALID = {
  C3: { intent: "LIST_MY_TICKETS", confidence: "HIGH", entities: {}, missingFields: [] },
  C5: { intent: "HANDOFF", confidence: "HIGH", entities: {}, missingFields: [] },
  C6: { intent: "CREATE_TICKET", confidence: "MEDIUM", entities: { problem: "parou tudo", impact: { workImpact: "BLOCKED" } }, missingFields: ["AFFECTED_SCOPE"] },
} as const;

export const turnInput = (caseId: string, model: unknown) => ({
  model: model as never,
  modelLabel: "dublê",
  provider: "mock" as const,
  testCase: caseById(caseId),
  repetition: 1,
  allowedHosts: [] as string[],
});
