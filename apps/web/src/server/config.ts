// Configuração do servidor do web, lida na inicialização (src/instrumentation.ts) e pelos módulos
// do servidor. Padrão do readConfig do ticket-service (apps/ticket-service/src/main.ts): variável
// definida é validada como veio; valor vazio, só com espaços ou malformado é erro, nunca
// substituído pelo padrão.

export interface WebConfig {
  webDatabaseUrl: string;
  ticketServiceUrl: string;
  ollamaBaseUrl: string;
}

export type ConfigResult = { ok: true; config: WebConfig } | { ok: false; errors: string[] };

// Mesmo padrão do spike do ADR-009 (endpoint compatível com OpenAI do Ollama local).
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

const SQLITE_URL_PREFIX = "file:";

function isBlank(value: string): boolean {
  return value.trim() === "";
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// SQLite pelo adapter better-sqlite3 (ADR-011): "file:" seguido de um caminho não vazio.
function isSqliteFileUrl(value: string): boolean {
  return value.startsWith(SQLITE_URL_PREFIX) && !isBlank(value.slice(SQLITE_URL_PREFIX.length));
}

export function readConfig(env: Record<string, string | undefined>): ConfigResult {
  const errors: string[] = [];

  const webDatabaseUrl = env["WEB_DATABASE_URL"];
  if (webDatabaseUrl === undefined || isBlank(webDatabaseUrl)) {
    errors.push("WEB_DATABASE_URL é obrigatória (ex.: file:./prisma/web-dev.db).");
  } else if (!isSqliteFileUrl(webDatabaseUrl)) {
    errors.push(`WEB_DATABASE_URL inválida: "${webDatabaseUrl}". Use "file:" seguido do caminho do banco SQLite.`);
  } else if (webDatabaseUrl === env["DATABASE_URL"]) {
    // ADR-011: os dois apps nunca usam o mesmo banco. A comparação é textual e tem limite: detecta
    // só o mesmo valor copiado para o processo do web. O isolamento real vem do .env por app, dos
    // nomes padrão diferentes (web-dev.db e dev.db) e do prisma/ de cada app; caminhos relativos se
    // resolvem a partir do diretório de cada app, que o web não conhece. Por isso não normaliza.
    errors.push("WEB_DATABASE_URL não pode ser igual a DATABASE_URL: o web e o ticket-service têm bancos separados (ADR-011).");
  }

  const ticketServiceUrl = env["TICKET_SERVICE_URL"];
  if (ticketServiceUrl === undefined || isBlank(ticketServiceUrl)) {
    errors.push("TICKET_SERVICE_URL é obrigatória (ex.: http://127.0.0.1:3001).");
  } else if (!isHttpUrl(ticketServiceUrl)) {
    errors.push(`TICKET_SERVICE_URL inválida: "${ticketServiceUrl}". Use uma URL http ou https.`);
  }

  const ollamaBaseUrl = env["OLLAMA_BASE_URL"] ?? DEFAULT_OLLAMA_BASE_URL;
  if (isBlank(ollamaBaseUrl)) {
    errors.push("OLLAMA_BASE_URL não pode ser vazia (padrão: http://localhost:11434/v1).");
  } else if (!isHttpUrl(ollamaBaseUrl)) {
    errors.push(`OLLAMA_BASE_URL inválida: "${ollamaBaseUrl}". Use uma URL http ou https.`);
  }

  if (errors.length > 0 || webDatabaseUrl === undefined || ticketServiceUrl === undefined) {
    return { ok: false, errors };
  }
  return { ok: true, config: { webDatabaseUrl, ticketServiceUrl, ollamaBaseUrl } };
}

export function formatConfigErrors(errors: readonly string[]): string {
  return `Configuração inválida:\n${errors.map((error) => `- ${error}`).join("\n")}`;
}

// Para os módulos do servidor: a inicialização já recusou configuração inválida, então uma falha
// aqui indica uso fora do servidor configurado.
export function requireConfig(env: Record<string, string | undefined> = process.env): WebConfig {
  const result = readConfig(env);
  if (!result.ok) throw new Error(formatConfigErrors(result.errors));
  return result.config;
}
