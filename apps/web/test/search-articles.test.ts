import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bundledArticleRepository, type ArticleRepository } from "../src/server/knowledge/articles";
import type { ConversationText } from "../src/server/knowledge/operating-system";
import { executeSearchArticles, type SearchArticlesDeps } from "../src/server/knowledge/search-articles";
import { logError } from "../src/server/observability/error-log";

const employee = (content: string): ConversationText => ({ authorType: "EMPLOYEE", content });
const deps = (articles: ArticleRepository = bundledArticleRepository): SearchArticlesDeps => ({ articles, logError });
const json: unknown = JSON.parse(readFileSync(new URL("../src/server/knowledge/articles.json", import.meta.url), "utf8"));

// Cenários v1.15 §2.3 (ENT-1).
const ENT1_SC02 = "Minha VPN está dando erro 809. Uso Windows 10.";
const ENT1_SC03 = "Minha VPN está dando erro 809. Uso Windows 11.";

describe("execução da searchArticles", () => {
  it("ENT-1, SC-02: o artigo de VPN passa no Windows 10, com applicability igual à do articles.json", () => {
    const outcome = executeSearchArticles({ query: ENT1_SC02 }, { messages: [employee(ENT1_SC02)] }, deps());
    expect(outcome).toStrictEqual({
      status: "SUCCESS",
      result: {
        articles: [
          {
            id: "ART-VPN-809",
            title: "VPN: erro 809",
            content:
              "Erro 809 na VPN do Windows 10: reinicie o serviço de VPN, confira se a rede permite a conexão e tente de novo. Se persistir, abra um chamado.",
            applicability: { operatingSystems: ["Windows 10"] },
          },
        ],
      },
      meta: { operatingSystem: { kind: "known", value: "Windows 10" }, rejectedByApplicability: [] },
    });
  });

  it("ENT-1, SC-03 (turno 1): o artigo de VPN é rejeitado no Windows 11 e a lista vai vazia", () => {
    const outcome = executeSearchArticles({ query: ENT1_SC03 }, { messages: [employee(ENT1_SC03)] }, deps());
    expect(outcome).toStrictEqual({
      status: "SUCCESS",
      result: { articles: [] },
      meta: { operatingSystem: { kind: "known", value: "Windows 11" }, rejectedByApplicability: ["ART-VPN-809"] },
    });
  });

  it("artigo sem applicability vai sem a chave (forma do descritor)", () => {
    const outcome = executeSearchArticles({ query: "horário" }, { messages: [] }, deps());
    expect(outcome.status).toBe("SUCCESS");
    const article = outcome.status === "SUCCESS" ? outcome.result.articles[0] : undefined;
    expect(article).toBeDefined();
    expect(Object.keys(article ?? {})).toStrictEqual(["id", "title", "content"]);
  });

  it("'Windows 10' só na consulta do modelo não muda o filtro", () => {
    const outcome = executeSearchArticles({ query: "VPN erro 809 Windows 10" }, { messages: [employee("A VPN dá erro 809.")] }, deps());
    expect(outcome).toMatchObject({
      status: "SUCCESS",
      result: { articles: [] },
      meta: { operatingSystem: { kind: "unknown", reason: "none" }, rejectedByApplicability: ["ART-VPN-809"] },
    });
  });

  it("'Windows' sem versão → artigo com applicability rejeitado", () => {
    const outcome = executeSearchArticles({ query: "vpn" }, { messages: [employee("Uso Windows.")] }, deps());
    expect(outcome).toMatchObject({ result: { articles: [] }, meta: { rejectedByApplicability: ["ART-VPN-809"] } });
  });

  it("lista vazia é SUCCESS", () => {
    const outcome = executeSearchArticles({ query: "Como faço para consultar meu saldo de férias?" }, { messages: [] }, deps());
    expect(outcome).toMatchObject({ status: "SUCCESS", result: { articles: [] } });
  });
});

describe("falha técnica da searchArticles", () => {
  let output: string[];

  beforeEach(() => {
    output = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      output.push(String(chunk));
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const SECRET_QUERY = "consulta-secreta vpn";
  const SECRET_MESSAGE = "mensagem-secreta Windows 10";

  const cases: [string, ArticleRepository, string][] = [
    [
      "repositório que lança",
      {
        load: () => {
          throw new Error("falha-secreta ao ler os artigos");
        },
      },
      "Error",
    ],
    [
      "artigo sem title (Zod)",
      { load: () => (Array.isArray(json) ? json.map((article: unknown, i) => (i === 0 ? { ...(article as object), title: undefined } : article)) : json) },
      "KnowledgeBaseInvalidError",
    ],
  ];

  it.each(cases)("%s → FAILED, { available: false }, registro só com evento, context e errorType", (_label, repository, errorType) => {
    const outcome = executeSearchArticles({ query: SECRET_QUERY }, { messages: [employee(SECRET_MESSAGE)] }, deps(repository));
    expect(outcome).toStrictEqual({ status: "FAILED", result: { available: false } });
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0] ?? "{}")).toStrictEqual({ event: "unexpected_error", context: "knowledge", errorType });
    const all = output.join("");
    for (const secret of ["consulta-secreta", "mensagem-secreta", "falha-secreta", "ART-"]) expect(all).not.toContain(secret);
  });
});
