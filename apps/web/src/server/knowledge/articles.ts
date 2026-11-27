import { TICKET_CATEGORIES } from "@nexo/contracts";
import { z } from "zod";
import articlesJson from "./articles.json";

// Módulo de conhecimento do web (ADR-003; DM v2.19 §3.11). Os artigos são os do spike do ADR-009,
// usados como dado de avaliação (plano PW-6), com os textos idênticos aos da tag spike-adr-009.

// DM §3.11. Mais estrito que o DM num ponto: applicability, quando presente, traz operatingSystems
// não vazio, que é a forma que o modelo vê na linha de base (test/baseline/v4/results-descriptor.json).
const articleSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  content: z.string().min(1),
  category: z.enum(TICKET_CATEGORIES).optional(),
  keywords: z.array(z.string().min(1)),
  applicability: z.strictObject({ operatingSystems: z.array(z.string().min(1)).min(1) }).optional(),
});

const articlesSchema = z.array(articleSchema).refine((articles) => new Set(articles.map((a) => a.id)).size === articles.length, {
  message: "ids de artigo repetidos",
});

export type KnowledgeArticle = z.infer<typeof articleSchema>;

// Artigos fora do contrato: falha técnica da busca, nunca artigo parcial.
export class KnowledgeBaseInvalidError extends Error {
  constructor() {
    super("artigos da central de ajuda fora do contrato do DM §3.11");
    this.name = "KnowledgeBaseInvalidError";
  }
}

// Fonte dos artigos, injetável nos testes. Devolve o dado cru; a validação é feita por quem carrega.
export interface ArticleRepository {
  load(): unknown;
}

export const bundledArticleRepository: ArticleRepository = { load: () => articlesJson };

export function loadArticles(repository: ArticleRepository): KnowledgeArticle[] {
  const parsed = articlesSchema.safeParse(repository.load());
  if (!parsed.success) throw new KnowledgeBaseInvalidError();
  return parsed.data;
}
