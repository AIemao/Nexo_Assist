import { describe, expect, it } from "vitest";
import { readConfig } from "../src/server/config";

const valid = {
  WEB_DATABASE_URL: "file:./prisma/web-dev.db",
  TICKET_SERVICE_URL: "http://127.0.0.1:3001",
};

describe("readConfig do web", () => {
  it("aceita a configuração mínima e usa o Ollama local por padrão", () => {
    expect(readConfig(valid)).toStrictEqual({
      ok: true,
      config: {
        webDatabaseUrl: "file:./prisma/web-dev.db",
        ticketServiceUrl: "http://127.0.0.1:3001",
        ollamaBaseUrl: "http://localhost:11434/v1",
      },
    });
  });

  it("aceita OLLAMA_BASE_URL definida", () => {
    const result = readConfig({ ...valid, OLLAMA_BASE_URL: "http://127.0.0.1:11434/v1" });
    expect(result.ok && result.config.ollamaBaseUrl).toBe("http://127.0.0.1:11434/v1");
  });

  it("recusa sem WEB_DATABASE_URL e sem TICKET_SERVICE_URL, listando os dois erros", () => {
    expect(readConfig({})).toStrictEqual({
      ok: false,
      errors: [
        "WEB_DATABASE_URL é obrigatória (ex.: file:./prisma/web-dev.db).",
        "TICKET_SERVICE_URL é obrigatória (ex.: http://127.0.0.1:3001).",
      ],
    });
  });

  it("recusa variáveis definidas e vazias", () => {
    const result = readConfig({ WEB_DATABASE_URL: "", TICKET_SERVICE_URL: "", OLLAMA_BASE_URL: "" });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toHaveLength(3);
  });

  it("recusa valores só com espaços nas três variáveis", () => {
    expect(readConfig({ WEB_DATABASE_URL: "   ", TICKET_SERVICE_URL: " \t ", OLLAMA_BASE_URL: "  " })).toStrictEqual({
      ok: false,
      errors: [
        "WEB_DATABASE_URL é obrigatória (ex.: file:./prisma/web-dev.db).",
        "TICKET_SERVICE_URL é obrigatória (ex.: http://127.0.0.1:3001).",
        "OLLAMA_BASE_URL não pode ser vazia (padrão: http://localhost:11434/v1).",
      ],
    });
  });

  it("recusa WEB_DATABASE_URL com esquema diferente de file:", () => {
    expect(readConfig({ ...valid, WEB_DATABASE_URL: "postgres://x" })).toStrictEqual({
      ok: false,
      errors: ['WEB_DATABASE_URL inválida: "postgres://x". Use "file:" seguido do caminho do banco SQLite.'],
    });
  });

  it("recusa WEB_DATABASE_URL com file: sem caminho, ou com caminho só de espaços", () => {
    for (const value of ["file:", "file:   "]) {
      expect(readConfig({ ...valid, WEB_DATABASE_URL: value })).toStrictEqual({
        ok: false,
        errors: [`WEB_DATABASE_URL inválida: "${value}". Use "file:" seguido do caminho do banco SQLite.`],
      });
    }
  });

  it("recusa WEB_DATABASE_URL igual a DATABASE_URL (ADR-011)", () => {
    const result = readConfig({ ...valid, DATABASE_URL: valid.WEB_DATABASE_URL });
    expect(result).toStrictEqual({
      ok: false,
      errors: [
        "WEB_DATABASE_URL não pode ser igual a DATABASE_URL: o web e o ticket-service têm bancos separados (ADR-011).",
      ],
    });
  });

  it("aceita DATABASE_URL diferente", () => {
    expect(readConfig({ ...valid, DATABASE_URL: "file:./prisma/dev.db" }).ok).toBe(true);
  });

  it("recusa URLs malformadas", () => {
    const result = readConfig({ ...valid, TICKET_SERVICE_URL: "127.0.0.1:3001", OLLAMA_BASE_URL: "ftp://x" });
    expect(result.ok ? [] : result.errors).toStrictEqual([
      'TICKET_SERVICE_URL inválida: "127.0.0.1:3001". Use uma URL http ou https.',
      'OLLAMA_BASE_URL inválida: "ftp://x". Use uma URL http ou https.',
    ]);
  });
});
