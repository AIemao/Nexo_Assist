// Tools da V4 (v4/CRITERIA.md, "Estrutura > Etapa 2"; "Ajustes da implementação (Etapa 2B)",
// exceção controlada 3). Só os textos que o modelo lê mudam; ids, estrutura dos schemas e execute são
// os da V1 (../../src/tools.ts, congelado, não alterado).
//
// O Mastra guarda o execute original numa variável interna do construtor da Tool, e o execute da
// instância é um envoltório que valida contra this.inputSchema na hora da chamada. Por isso a V4 não
// recria a tool: chama o createFakeTools() da V1 e, em cada instância recém-criada, troca só
// description e inputSchema, antes de o Agent ser construído. Nenhum outro campo muda.
import type { z } from "zod";

import { TOOL_INPUT_SCHEMAS, createFakeTools } from "../../src/tools.ts";
import { ARGUMENT_DESCRIPTIONS_V4, TOOL_DESCRIPTIONS_V4 } from "./descriptions.ts";

type ToolName = keyof typeof TOOL_INPUT_SCHEMAS;

// Os schemas da V1 com só os .describe trocados. .describe() devolve um schema novo: os da V1 ficam
// intactos.
export const TOOL_INPUT_SCHEMAS_V4 = {
  searchArticles: TOOL_INPUT_SCHEMAS.searchArticles.extend({
    query: TOOL_INPUT_SCHEMAS.searchArticles.shape.query.describe(ARGUMENT_DESCRIPTIONS_V4.searchArticles.query),
  }),
  listMyTickets: TOOL_INPUT_SCHEMAS.listMyTickets,
  proposeTicketDraft: TOOL_INPUT_SCHEMAS.proposeTicketDraft,
  requestHandoff: TOOL_INPUT_SCHEMAS.requestHandoff.extend({
    reason: TOOL_INPUT_SCHEMAS.requestHandoff.shape.reason.describe(ARGUMENT_DESCRIPTIONS_V4.requestHandoff.reason),
  }),
} satisfies Record<ToolName, z.ZodType>;

// Uma fábrica por sessão, como a da V1: instâncias novas a cada chamada, com o próprio toolLog.
export function createFakeToolsV4(): ReturnType<typeof createFakeTools> {
  const fake = createFakeTools();
  for (const name of Object.keys(TOOL_INPUT_SCHEMAS) as ToolName[]) {
    const tool = fake.tools[name] as { description: string; inputSchema: unknown };
    tool.description = TOOL_DESCRIPTIONS_V4[name];
    tool.inputSchema = TOOL_INPUT_SCHEMAS_V4[name];
  }
  return fake;
}
