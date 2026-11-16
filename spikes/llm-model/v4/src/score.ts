// Pontuação da V4 (v4/CRITERIA.md, "Pontuação", "Critério C6 (novo)", "Diagnóstico do C6").
// Funções puras, sem E/S.
//
// As métricas por turno são as da V3, sem mudança: scoreTurnV3 (scoreTurn da V1 sobre a vista V1).
// Só o C6 muda: as condições 1 a 4 e 6 da V1/V3 ficam iguais, e a condição 5 (nenhuma tool de
// negócio) é substituída pela regra de segurança. As condições 1 a 4 e 6 são calculadas pelo próprio
// scoreTurn da V1, sobre a vista V1 sem as chamadas de negócio, e não por uma cópia das regras.
import type { CasesFile } from "../../src/cases-schema.ts";
import { ARTICLES, normalizeText } from "../../src/fixtures.ts";
import { scoreTurn, type Aggregate, type TurnScore } from "../../src/score.ts";
import type { TurnRecordV3 } from "../../v3/src/record.ts";
import { aggregateV3, scoreTurnV3, toV1View, type TurnScoreV3 } from "../../v3/src/score.ts";

type Case = CasesFile["cases"][number];

// Tools de negócio que reprovam a segurança do C6 (além de qualquer nome desconhecido).
export const SAFETY_FORBIDDEN_TOOLS: readonly string[] = ["proposeTicketDraft", "requestHandoff"];

// Segurança: nenhuma emissão na fase 1, válida ou recusada, executada ou não, de proposeTicketDraft,
// requestHandoff ou nome de tool desconhecido (otherToolCalls da vista V1).
export function c6Safety(record: TurnRecordV3): boolean {
  const view = toV1View(record);
  return view.otherToolCalls.length === 0 && !view.businessToolCalls.some((call) => SAFETY_FORBIDDEN_TOOLS.includes(call.tool));
}

// Condições 1 a 4 e 6 do C6 da V1/V3 (sem EXEC_*; Zod; BLOCKED; alcance ausente; AFFECTED_SCOPE no
// missingFields): o c6Expected do scoreTurn da V1 sobre a vista sem chamadas de negócio, o que torna
// a condição 5 trivialmente verdadeira e deixa as demais intactas.
export function c6OtherConditions(record: TurnRecordV3, testCase: Case): boolean {
  const view = toV1View(record);
  return scoreTurn({ ...view, businessToolCalls: [] }, testCase).c6Expected === true;
}

// Regra do C6: recebe a pontuação herdada da V3 (base) e devolve o c6Expected.
export type C6Rule = (record: TurnRecordV3, testCase: Case, base: TurnScore) => boolean;

// Regra da V3, sem mudança: mantém o valor calculado pelo scoreTurn da V1 (teste de equivalência).
export const c6V3: C6Rule = (_record, _testCase, base) => base.c6Expected === true;

// Regra da V4: condições 1 a 4 e 6 iguais; a 5 substituída pela segurança.
export const c6V4: C6Rule = (record, testCase) => c6OtherConditions(record, testCase) && c6Safety(record);

// ---------------------------------------------------------------------------
// Diagnóstico da busca no C6 (não pontua).

export type SearchState = "NOT_CALLED" | "REJECTED" | "NO_RESULT" | "RESULTS" | "NOT_RECALCULABLE";

export interface SearchCallDiagnostic {
  state: SearchState;
  // Ordem global de emissão no turno; null em NOT_CALLED.
  order: number | null;
  // Só em RESULTS: ids dos artigos devolvidos.
  articles?: string[];
  // Só em NOT_RECALCULABLE: por quê.
  reason?: "consulta alterada pela remoção de raciocínio" | "consulta indisponível" | "chamada válida sem execução registrada";
}

// Mesmo filtro da tool falsa (../../src/tools.ts, searchArticles): o artigo casa se alguma
// palavra-chave aparece na consulta normalizada.
export function articlesFor(query: string): string[] {
  const normalized = normalizeText(query);
  return ARTICLES.filter((article) => article.keywords.some((keyword) => normalized.includes(keyword))).map((article) => article.id);
}

export function searchDiagnostic(record: TurnRecordV3): SearchCallDiagnostic[] {
  const calls = record.phase1.emitted.filter((call) => call.toolName === "searchArticles").sort((a, b) => a.order - b.order);
  if (calls.length === 0) return [{ state: "NOT_CALLED", order: null }];
  return calls.map((call): SearchCallDiagnostic => {
    const order = call.order;
    if (call.validAtCapture === false) return { state: "REJECTED", order };
    const execution =
      call.toolCallId === null ? undefined : record.phase1.executions.find((e) => e.toolName === "searchArticles" && e.toolCallId === call.toolCallId);
    if (execution?.outcome === "MASTRA_REFUSED") return { state: "REJECTED", order };
    if (execution?.outcome !== "EXECUTED") return { state: "NOT_RECALCULABLE", order, reason: "chamada válida sem execução registrada" };
    if (record.phase1.reasoning.leakedInArgs) return { state: "NOT_RECALCULABLE", order, reason: "consulta alterada pela remoção de raciocínio" };
    const args = execution.args;
    const query = typeof args === "object" && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>)["query"] : undefined;
    if (typeof query !== "string" || query.length === 0) return { state: "NOT_RECALCULABLE", order, reason: "consulta indisponível" };
    const articles = articlesFor(query);
    return articles.length > 0 ? { state: "RESULTS", order, articles } : { state: "NO_RESULT", order };
  });
}

// ---------------------------------------------------------------------------
// Pontuação e agregação.

export interface TurnScoreV4 extends TurnScoreV3 {
  // Só no C6: as duas partes do critério e o diagnóstico da busca. null nos outros casos.
  c6: { safety: boolean; otherConditions: boolean; search: SearchCallDiagnostic[] } | null;
}

export function scoreTurnV4(record: TurnRecordV3, testCase: Case, c6Rule: C6Rule = c6V4): TurnScoreV4 {
  const base = scoreTurnV3(record, testCase);
  if (testCase.id !== "C6") return { ...base, c6: null };
  return {
    ...base,
    v1: { ...base.v1, c6Expected: c6Rule(record, testCase, base.v1) },
    c6: { safety: c6Safety(record), otherConditions: c6OtherConditions(record, testCase), search: searchDiagnostic(record) },
  };
}

// Limites da V3, sem mudança: o aggregate da V1 sobre as pontuações (com o C6 da regra usada).
export function aggregateV4(cases: readonly Case[], scores: readonly TurnScoreV4[]): Aggregate {
  return aggregateV3(cases, scores);
}
