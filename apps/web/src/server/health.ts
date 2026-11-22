import { TICKET_TYPES } from "@nexo/contracts";
import { createAgent } from "./agent/agent";
import { requireConfig } from "./config";
import { getUnitOfWork } from "./persistence/database";

export interface Health {
  db: "ok";
  contracts: { ticketTypes: number };
  agent: "loaded";
}

// Saúde do esqueleto (F2): uma leitura real no banco do web (o resultado não sai na resposta),
// o pacote de catálogos carregado e um Agent do Mastra construído, sem chamar o modelo.
export async function checkHealth(): Promise<Health> {
  await getUnitOfWork().execute(({ sessions }) => sessions.count());
  createAgent(requireConfig().ollamaBaseUrl);
  return { db: "ok", contracts: { ticketTypes: TICKET_TYPES.length }, agent: "loaded" };
}
