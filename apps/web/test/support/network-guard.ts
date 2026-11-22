// Plano G1: nos testes do web, o fetch global só alcança 127.0.0.1. Qualquer outro destino
// (inclusive localhost, onde fica o Ollama) é recusado antes de sair da máquina.
// Cobre só o fetch global, que é o caminho do provider do Mastra (endpoint compatível com
// OpenAI do Ollama) e do cliente do ticket-service. Não cobre node:http, node:https nem sockets
// (node:net): código que use esses módulos diretamente não é bloqueado por este arquivo.
const ALLOWED_HOSTNAME = "127.0.0.1";

export class NetworkBlockedError extends Error {
  constructor(target: string) {
    super(`rede bloqueada nos testes: destino fora de ${ALLOWED_HOSTNAME} (${target})`);
    this.name = "NetworkBlockedError";
  }
}

function targetOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const originalFetch = globalThis.fetch;

globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const target = targetOf(input);
  let hostname: string;
  try {
    hostname = new URL(target).hostname;
  } catch {
    throw new NetworkBlockedError(target);
  }
  if (hostname !== ALLOWED_HOSTNAME) throw new NetworkBlockedError(target);
  return originalFetch(input, init);
}) as typeof fetch;
