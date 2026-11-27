import { describe, expect, it } from "vitest";
import { bundledArticleRepository, loadArticles } from "../src/server/knowledge/articles";
import { searchArticles, STOP_WORDS, tokenize } from "../src/server/knowledge/search";

const articles = loadArticles(bundledArticleRepository);
const ids = (query: string) => searchArticles(query, articles).map((a) => a.id);

describe("artigos da central de ajuda (PW-6; DM §3.11)", () => {
  it("articles.json passa no Zod, com ids únicos", () => {
    expect(articles.map((a) => a.id)).toStrictEqual(["ART-HORARIO", "ART-VPN-809"]);
    expect(new Set(articles.map((a) => a.id)).size).toBe(articles.length);
  });
});

describe("busca lexical (ADR-003; desvio D-3)", () => {
  it.each(["horário", "horario", "Qual é o horário de atendimento do service desk?"])("%s → ART-HORARIO primeiro", (query) => {
    expect(ids(query)[0]).toBe("ART-HORARIO");
  });

  it.each(["erro 809", "VPN", "vpn"])("%s → o artigo de VPN", (query) => {
    expect(ids(query)).toStrictEqual(["ART-VPN-809"]);
  });

  it("a consulta do SC-12 não casa nenhum artigo", () => {
    expect(ids("Como faço para consultar meu saldo de férias?")).toStrictEqual([]);
  });

  it("números são tokens e tokens de 1 caractere são descartados", () => {
    expect(tokenize("Erro 809 e a VPN")).toStrictEqual(["erro", "809", "vpn"]);
  });

  it("empate: id crescente por comparação ordinal", () => {
    const tied = [
      { id: "b", title: "Rede", content: "", keywords: [] },
      { id: "B", title: "Rede", content: "", keywords: [] },
      { id: "a", title: "Rede", content: "", keywords: [] },
    ];
    expect(searchArticles("rede", tied).map((a) => a.id)).toStrictEqual(["B", "a", "b"]);
  });

  it("palavra-chave vale mais que título, que vale mais que conteúdo", () => {
    const sample = [
      { id: "conteudo", title: "x", content: "impressora", keywords: [] },
      { id: "titulo", title: "Impressora", content: "", keywords: [] },
      { id: "chave", title: "x", content: "", keywords: ["impressora"] },
    ];
    expect(searchArticles("impressora", sample).map((a) => a.id)).toStrictEqual(["chave", "titulo", "conteudo"]);
  });
});

describe("palavras vazias", () => {
  // Lista literal: mudar a lista do código sem mudar esta falha o teste.
  const EXPECTED = [
    "as", "os", "um", "uma", "uns", "umas",
    "de", "da", "do", "das", "dos", "em", "na", "no", "nas", "nos", "ao", "aos", "pelo", "pela",
    "por", "para", "pra", "com", "sem", "sobre",
    "ou", "que", "se", "mas",
    "qual", "quais", "como", "onde", "quando", "quem",
    "eu", "me", "mim", "meu", "minha", "meus", "minhas", "seu", "sua", "seus", "suas",
    "voce", "ele", "ela", "isso", "isto", "esse", "essa", "este", "esta",
    "estou", "estao", "estava", "sou", "ser", "foi", "tem", "tenho", "ter", "ha", "faco", "fazer",
  ];

  it("a lista exportada é igual à lista literal", () => {
    expect([...STOP_WORDS]).toStrictEqual(EXPECTED);
  });

  it.each(EXPECTED)("%s, sozinha na consulta, devolve lista vazia", (word) => {
    expect(ids(word)).toStrictEqual([]);
  });
});
