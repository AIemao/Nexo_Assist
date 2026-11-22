import { Agent } from "@mastra/core/agent";

// ADR-009: qwen3:8b servido localmente pelo Ollama, pelo model router do Mastra com url (o mesmo
// caminho do spike; ADR-009, nota de 2026-11-22, W8.1). Esqueleto da F2: só constrói o Agent.
// Construir não faz requisição ao Ollama; as instruções e as tools entram nas fatias seguintes.
export const MODEL_ID = "ollama/qwen3:8b";

export function createAgent(ollamaBaseUrl: string): Agent {
  return new Agent({
    id: "nexo-assist",
    name: "nexo-assist",
    instructions: "Esqueleto do web (F2): instruções do produto ainda não definidas.",
    model: { id: MODEL_ID, url: ollamaBaseUrl },
  });
}
