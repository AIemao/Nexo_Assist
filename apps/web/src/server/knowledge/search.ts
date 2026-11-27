// Busca lexical da central de ajuda (ADR-003: título, conteúdo e palavras-chave; desvio D-3 da W8.3,
// que na V4 casava só palavras-chave por substring da consulta). Função pura.
//
// Normalização: minúsculas, NFD sem diacríticos, tokens separados por qualquer caractere que não seja
// letra ou algarismo. Números são tokens ("809"). Tokens de 1 caractere e as palavras vazias abaixo
// são descartados.
//
// Pontuação (o ADR-003 não define uma): cada token distinto da consulta vale 3 se for uma palavra-chave,
// 2 se estiver no título e 1 se estiver no conteúdo, o maior entre os campos. A pontuação do artigo é a
// soma; só entram artigos com pontuação maior que zero. Ordem: pontuação decrescente, depois id
// crescente por comparação ordinal. Sem limite de resultados, como na V4.

// Palavras vazias do português, já normalizadas (sem acento, minúsculas): artigos, preposições e
// contrações, conjunções, pronomes e verbos auxiliares comuns. Mudar a lista muda a busca; o teste a fixa.
export const STOP_WORDS = [
  "as", "os", "um", "uma", "uns", "umas",
  "de", "da", "do", "das", "dos", "em", "na", "no", "nas", "nos", "ao", "aos", "pelo", "pela",
  "por", "para", "pra", "com", "sem", "sobre",
  "ou", "que", "se", "mas",
  "qual", "quais", "como", "onde", "quando", "quem",
  "eu", "me", "mim", "meu", "minha", "meus", "minhas", "seu", "sua", "seus", "suas",
  "voce", "ele", "ela", "isso", "isto", "esse", "essa", "este", "esta",
  "estou", "estao", "estava", "sou", "ser", "foi", "tem", "tenho", "ter", "ha", "faco", "fazer",
] as const;

const STOP_WORD_SET: ReadonlySet<string> = new Set(STOP_WORDS);

export interface SearchableArticle {
  id: string;
  title: string;
  content: string;
  keywords: readonly string[];
}

export function normalizeText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1 && !STOP_WORD_SET.has(token));
}

const KEYWORD_POINTS = 3;
const TITLE_POINTS = 2;
const CONTENT_POINTS = 1;

export function scoreArticle(queryTokens: ReadonlySet<string>, article: SearchableArticle): number {
  const keywords = new Set(article.keywords.map(normalizeText));
  const title = new Set(tokenize(article.title));
  const content = new Set(tokenize(article.content));
  let score = 0;
  for (const token of queryTokens) {
    if (keywords.has(token)) score += KEYWORD_POINTS;
    else if (title.has(token)) score += TITLE_POINTS;
    else if (content.has(token)) score += CONTENT_POINTS;
  }
  return score;
}

export function searchArticles<T extends SearchableArticle>(query: string, articles: readonly T[]): T[] {
  const queryTokens = new Set(tokenize(query));
  return articles
    .map((article) => ({ article, score: scoreArticle(queryTokens, article) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || (a.article.id < b.article.id ? -1 : a.article.id > b.article.id ? 1 : 0))
    .map(({ article }) => article);
}
