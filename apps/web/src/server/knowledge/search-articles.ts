import { errorTypeOf, type ErrorLogger } from "../observability/error-log";
import { loadArticles, type ArticleRepository } from "./articles";
import { detectOperatingSystem, passesApplicability, type ConversationText, type OperatingSystem } from "./operating-system";
import { searchArticles } from "./search";

// Execução da searchArticles (ADR-003; AF v1.9, nota de 2026-11-22; DM v2.19 §3.12). Busca lexical e,
// depois, filtro de aplicabilidade. Sem retry: a busca é local (PW-12). Quem registra a tool no Mastra,
// persiste toolExecutions e compara com a linha de base é a F7.

// Argumentos já validados, com o schema da linha de base (projection.json: query string, minLength 1).
export interface SearchArticlesArgs {
  query: string;
}

// Montado pelo código, nunca pelo modelo: as mensagens persistidas da conversa, em ordem.
export interface SearchArticlesContext {
  messages: readonly ConversationText[];
}

// Exatamente o que vai ao modelo (results-descriptor.json): applicability ausente ou presente com os
// valores e a ordem do articles.json.
export interface ArticleResult {
  id: string;
  title: string;
  content: string;
  applicability?: { operatingSystems: string[] };
}

export type SearchArticlesOutcome =
  | {
      status: "SUCCESS";
      result: { articles: ArticleResult[] };
      meta: { operatingSystem: OperatingSystem; rejectedByApplicability: string[] };
    }
  // Falha técnica (artigos fora do contrato ou exceção): falha total, nunca artigos parciais. Candidata
  // a desvio D-7: a V4 não tem esta variante.
  | { status: "FAILED"; result: { available: false } };

export interface SearchArticlesDeps {
  articles: ArticleRepository;
  logError: ErrorLogger;
}

export function executeSearchArticles(
  args: SearchArticlesArgs,
  context: SearchArticlesContext,
  deps: SearchArticlesDeps,
): SearchArticlesOutcome {
  try {
    const found = searchArticles(args.query, loadArticles(deps.articles));
    const operatingSystem = detectOperatingSystem(context.messages);
    const articles: ArticleResult[] = [];
    const rejectedByApplicability: string[] = [];
    for (const article of found) {
      if (!passesApplicability(article, operatingSystem)) {
        rejectedByApplicability.push(article.id);
        continue;
      }
      articles.push({
        id: article.id,
        title: article.title,
        content: article.content,
        ...(article.applicability === undefined
          ? {}
          : { applicability: { operatingSystems: [...article.applicability.operatingSystems] } }),
      });
    }
    return { status: "SUCCESS", result: { articles }, meta: { operatingSystem, rejectedByApplicability } };
  } catch (error) {
    // Só o evento, o context e o errorType: nunca a consulta, a mensagem do erro, os artigos nem o texto
    // das mensagens.
    deps.logError({ context: "knowledge", errorType: errorTypeOf(error) });
    return { status: "FAILED", result: { available: false } };
  }
}
