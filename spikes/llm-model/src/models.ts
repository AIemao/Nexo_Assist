import { createGroq } from "@ai-sdk/groq";
import type { MastraModelConfig, OpenAICompatibleConfig } from "@mastra/core/llm";

// Configuração dos três modelos do spike (CRITERIA.md, "Modelos"). Só declaração: nada aqui
// executa um modelo. O typecheck confere a forma da configuração, NÃO a integração
// Mastra/provider em tempo de execução (E2), que é verificada na Fase 2.

// Ollama pelo caminho documentado pelo Mastra para servidores locais: endpoint compatível com
// OpenAI, pelo model router com `url` (https://mastra.ai/models). O contexto (8192) é do
// servidor: OLLAMA_CONTEXT_LENGTH=8192, conferido na coluna CONTEXT do `ollama ps`; o endpoint
// compatível com OpenAI não recebe `num_ctx`.
const OLLAMA_URL = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434/v1";

function ollama(model: string): OpenAICompatibleConfig {
  return { id: `ollama/${model}`, url: OLLAMA_URL };
}

export interface SpikeModel {
  role: "principal" | "comparação" | "referência";
  label: string;
  config: MastraModelConfig;
}

export function spikeModels(): SpikeModel[] {
  return [
    { role: "principal", label: "ollama qwen3:4b-instruct", config: ollama("qwen3:4b-instruct") },
    { role: "comparação", label: "ollama qwen3:8b", config: ollama("qwen3:8b") },
    {
      role: "referência",
      label: "groq openai/gpt-oss-120b",
      // A chave vem do ambiente (GROQ_API_KEY), nunca do código (README §8).
      config: createGroq({ apiKey: process.env["GROQ_API_KEY"] ?? "" })("openai/gpt-oss-120b"),
    },
  ];
}
