// Pontuação do spike do ADR-009, exatamente pelas regras do CRITERIA.md (congelado em
// 2026-11-11): "Avaliação de cada resultado", "Regras dos gabaritos", "Representação",
// "Erros: semânticos e de execução" e "Limites de aprovação". Funções puras: nenhuma E/S.
// E1 a E4 não são pontuados aqui (verificados fora do score).

import type { CasesFile } from "./cases-schema.ts";
import { normalizeText } from "./fixtures.ts";
import { INPUT_TOKEN_BUDGET, type ExecCode, type SemCode, type TruncationStatus, type TurnRecord } from "./run-record.ts";
import { interpretationSchema, type Interpretation } from "./schema.ts";

type Case = CasesFile["cases"][number];
type FieldRule = Case["expected"]["entities"][number];

export interface TurnScore {
  caseId: string;
  repetition: number;
  executed: boolean;
  execCode: ExecCode | null;
  zodValid: boolean;
  intentCorrect: boolean;
  toolCorrect: boolean;
  entitiesCorrect: boolean;
  // Só no C6 ("Parou tudo!"); null nos outros casos.
  c6Expected: boolean | null;
  reasoningLeak: boolean;
  // Estado da verificação de truncamento (run-record.ts, TruncationStatus).
  truncation: TruncationStatus;
  contextTruncated: boolean;
  externalEffect: boolean;
  reasons: (ExecCode | SemCode)[];
  // Chave de estabilidade: intenção + conjunto de tools de negócio. Turno com erro de execução
  // ou interpretação inválida recebe chave única (não concorda com nenhum outro).
  stabilityKey: string;
}

// Valor de um caminho com pontos ("impact.workImpact"); undefined se algum trecho falta.
export function valueAt(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split(".")) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

// CRITERIA.md, "Regras dos gabaritos": presença e valor.
export function fieldRuleHolds(source: unknown, rule: FieldRule): boolean {
  const value = valueAt(source, rule.path);
  if (rule.presence === "absent") return value === undefined;
  if (value === undefined) return rule.presence === "optional";
  switch (rule.rule.match) {
    case "any":
      return true;
    case "equals":
      return typeof value === "string" && rule.rule.values.includes(value);
    case "normalized-contains-any": {
      if (typeof value !== "string") return false;
      const normalized = normalizeText(value);
      return rule.rule.values.some((term) => normalized.includes(term));
    }
  }
}

function missingFieldsHold(missing: readonly string[], rule: Case["expected"]["missingFields"]): boolean {
  if (rule.mode === "exact") {
    // Exatamente a lista, em qualquer ordem, sem repetição.
    if (new Set(missing).size !== missing.length) return false;
    return missing.length === rule.values.length && rule.values.every((v) => missing.includes(v));
  }
  return rule.required.every((v) => missing.includes(v)) && !rule.forbidden.some((v) => missing.includes(v));
}

function argsHold(args: unknown, toolArgs: NonNullable<Case["expected"]["toolArgs"]>): boolean {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return false;
  if (toolArgs.forbidden.some((name) => Object.hasOwn(args, name))) return false;
  return toolArgs.fields.every((rule) => fieldRuleHolds(args, rule));
}

// CRITERIA.md, "Avaliação de cada resultado", item 3 (só tools de negócio).
function scoreTool(record: TurnRecord, expected: Case["expected"]): { correct: boolean; reason: SemCode | null } {
  const calls = record.businessToolCalls;
  if (record.otherToolCalls.length > 0) return { correct: false, reason: "SEM_WRONG_TOOL" };
  if (expected.expectedTool === "none") {
    return calls.length === 0 ? { correct: true, reason: null } : { correct: false, reason: "SEM_WRONG_TOOL" };
  }
  const allowed = new Set<string>([expected.expectedTool, ...expected.allowedExtraTools]);
  if (calls.some((call) => !allowed.has(call.tool))) return { correct: false, reason: "SEM_WRONG_TOOL" };
  const ofExpected = calls.filter((call) => call.tool === expected.expectedTool);
  if (ofExpected.length === 0) return { correct: false, reason: "SEM_WRONG_TOOL" };
  const toolArgs = expected.toolArgs;
  if (toolArgs === null) return { correct: false, reason: "SEM_WRONG_TOOL_ARGS" };
  // Toda chamada da tool esperada obedece; chamada recusada pela validação conta como erro.
  const argsOk = ofExpected.every((call) => !call.rejected && argsHold(call.args, toolArgs));
  return argsOk ? { correct: true, reason: null } : { correct: false, reason: "SEM_WRONG_TOOL_ARGS" };
}

function businessToolSet(record: TurnRecord): string {
  const names = [...new Set(record.businessToolCalls.map((call) => call.tool))].sort();
  return names.length === 0 ? "none" : names.join("+");
}

// Pontua um turno contra o gabarito do caso.
export function scoreTurn(record: TurnRecord, testCase: Case): TurnScore {
  if (record.caseId !== testCase.id) throw new Error(`registro de ${record.caseId} pontuado contra ${testCase.id}`);
  const isC6 = testCase.id === "C6";
  const uniqueKey = `unique:${record.caseId}:${record.repetition}`;

  // Erros de execução: o do run e os que o CRITERIA classifica como EXEC a partir do registro.
  const truncation: TruncationStatus =
    record.contextCheck.status === "DETECTED" || (record.contextCheck.maxReportedInputTokens ?? 0) > INPUT_TOKEN_BUDGET
      ? "DETECTED"
      : record.contextCheck.status;
  const contextTruncated = truncation === "DETECTED";
  const externalEffect = record.externalRequests.length > 0;
  const execCode: ExecCode | null =
    record.status === "execution_error"
      ? (record.execError?.code ?? "EXEC_FRAMEWORK")
      : contextTruncated
        ? "EXEC_CONTEXT_TRUNCATED"
        : externalEffect
          ? "EXEC_EXTERNAL_EFFECT"
          : null;

  const reasoningLeak = record.reasoning.leakedInText || record.reasoning.leakedInInterpretation;

  if (execCode !== null) {
    // Incorreto em todas as métricas (CRITERIA.md).
    return {
      caseId: record.caseId,
      repetition: record.repetition,
      executed: record.status === "completed",
      execCode,
      zodValid: false,
      intentCorrect: false,
      toolCorrect: false,
      entitiesCorrect: false,
      c6Expected: isC6 ? false : null,
      reasoningLeak,
      truncation,
      contextTruncated,
      externalEffect,
      reasons: reasoningLeak ? [execCode, "SEM_REASONING_LEAK"] : [execCode],
      stabilityKey: uniqueKey,
    };
  }

  const reasons: SemCode[] = [];
  const parsed = interpretationSchema.safeParse(record.interpretationRaw);
  const interpretation: Interpretation | null = parsed.success ? parsed.data : null;
  const zodValid = interpretation !== null;
  if (!zodValid) reasons.push("SEM_INVALID_INTERPRETATION");

  const expected = testCase.expected;
  const intentCorrect = interpretation !== null && interpretation.intent === expected.intent;
  if (interpretation !== null && !intentCorrect) reasons.push("SEM_WRONG_INTENT");

  const tool = scoreTool(record, expected);
  if (tool.reason !== null) reasons.push(tool.reason);

  let entitiesCorrect = false;
  if (interpretation !== null) {
    const entitiesOk = expected.entities.every((rule) => fieldRuleHolds(interpretation.entities, rule));
    const missingOk = missingFieldsHold(interpretation.missingFields, expected.missingFields);
    if (!entitiesOk) reasons.push("SEM_WRONG_ENTITIES");
    if (!missingOk) reasons.push("SEM_WRONG_MISSING_FIELDS");
    entitiesCorrect = entitiesOk && missingOk;
  }

  if (reasoningLeak) reasons.push("SEM_REASONING_LEAK");

  // CRITERIA.md, "Parou tudo!" (C6): impacto e ação esperados.
  const c6Expected = isC6
    ? interpretation !== null &&
      interpretation.entities.impact?.workImpact === "BLOCKED" &&
      interpretation.entities.impact?.affectedScope === undefined &&
      record.businessToolCalls.length === 0 &&
      interpretation.missingFields.includes("AFFECTED_SCOPE")
    : null;

  return {
    caseId: record.caseId,
    repetition: record.repetition,
    executed: true,
    execCode: null,
    zodValid,
    intentCorrect,
    toolCorrect: tool.correct,
    entitiesCorrect,
    c6Expected,
    reasoningLeak,
    truncation,
    contextTruncated: false,
    externalEffect: false,
    reasons,
    stabilityKey: interpretation === null ? uniqueKey : `${interpretation.intent}|${businessToolSet(record)}`,
  };
}

export interface ThresholdResult {
  count: number;
  required: number;
  pass: boolean;
}

export interface Aggregate {
  denominator: 18;
  zodValid: ThresholdResult;
  intent: ThresholdResult & { majorityCases: number; majorityRequired: 5 };
  tool: ThresholdResult & { majorityCases: number; majorityRequired: 5 };
  entities: ThresholdResult;
  stability: {
    concordanceByCase: Record<string, number>;
    allSameCases: number;
    allSameRequired: 4;
    othersMinConcordance: number | null;
    pass: boolean;
  };
  c6: ThresholdResult;
  zeroTolerance: {
    reasoningLeaks: number;
    externalEffects: number;
    // Truncamento: só aprova com os 18 turnos em NOT_DETECTED; DETECTED reprova; UNKNOWN deixa inconclusivo.
    truncation: { notDetected: number; detected: number; unknown: number; status: "pass" | "fail" | "inconclusive" };
    pass: boolean;
  };
  // Aprovado nos limites. E1 a E4 são verificados fora do score.
  approvedOnThresholds: boolean;
}

// Maior número de repetições com a mesma chave de estabilidade.
function concordance(keys: string[]): number {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return Math.max(...counts.values());
}

// Agrega os 18 resultados (6 casos × 3 repetições). Exige exatamente um registro por par
// caso/repetição: o denominador é fixo, e o run grava as 18 linhas mesmo quando para cedo.
export function aggregate(cases: readonly Case[], scores: readonly TurnScore[]): Aggregate {
  if (cases.length !== 6) throw new Error(`esperados 6 casos, recebidos ${cases.length}`);
  const byCase = new Map<string, TurnScore[]>();
  for (const c of cases) byCase.set(c.id, []);
  for (const s of scores) {
    const list = byCase.get(s.caseId);
    if (list === undefined) throw new Error(`resultado de caso desconhecido: ${s.caseId}`);
    if (list.some((other) => other.repetition === s.repetition)) {
      throw new Error(`resultado repetido: ${s.caseId}, repetição ${s.repetition}`);
    }
    list.push(s);
  }
  for (const [caseId, list] of byCase) {
    const reps = list.map((s) => s.repetition).sort();
    if (reps.join(",") !== "1,2,3") throw new Error(`${caseId}: esperadas as repetições 1, 2 e 3, recebidas ${reps.join(", ") || "nenhuma"}`);
  }

  const all = [...byCase.values()].flat();
  const count = (pick: (s: TurnScore) => boolean) => all.filter(pick).length;
  const majorityCases = (pick: (s: TurnScore) => boolean) =>
    [...byCase.values()].filter((list) => list.filter(pick).length >= 2).length;

  const zodCount = count((s) => s.zodValid);
  const intentCount = count((s) => s.intentCorrect);
  const intentMajority = majorityCases((s) => s.intentCorrect);
  const toolCount = count((s) => s.toolCorrect);
  const toolMajority = majorityCases((s) => s.toolCorrect);
  const entitiesCount = count((s) => s.entitiesCorrect);

  const concordanceByCase: Record<string, number> = {};
  for (const [caseId, list] of byCase) concordanceByCase[caseId] = concordance(list.map((s) => s.stabilityKey));
  const values = Object.values(concordanceByCase);
  const allSameCases = values.filter((v) => v === 3).length;
  const others = values.filter((v) => v < 3);
  const othersMinConcordance = others.length === 0 ? null : Math.min(...others);
  const stabilityPass = allSameCases >= 4 && others.every((v) => v >= 2);

  const c6List = byCase.get("C6") ?? [];
  const c6Count = c6List.filter((s) => s.c6Expected === true).length;

  const reasoningLeaks = count((s) => s.reasoningLeak);
  const externalEffects = count((s) => s.externalEffect);
  const detected = count((s) => s.truncation === "DETECTED");
  const unknown = count((s) => s.truncation === "UNKNOWN");
  const truncationStatus = detected > 0 ? "fail" : unknown > 0 ? "inconclusive" : "pass";

  const result: Aggregate = {
    denominator: 18,
    zodValid: { count: zodCount, required: 17, pass: zodCount >= 17 },
    intent: { count: intentCount, required: 15, majorityCases: intentMajority, majorityRequired: 5, pass: intentCount >= 15 && intentMajority >= 5 },
    tool: { count: toolCount, required: 15, majorityCases: toolMajority, majorityRequired: 5, pass: toolCount >= 15 && toolMajority >= 5 },
    entities: { count: entitiesCount, required: 15, pass: entitiesCount >= 15 },
    stability: { concordanceByCase, allSameCases, allSameRequired: 4, othersMinConcordance, pass: stabilityPass },
    c6: { count: c6Count, required: 3, pass: c6Count === 3 },
    zeroTolerance: {
      reasoningLeaks,
      externalEffects,
      truncation: { notDetected: count((s) => s.truncation === "NOT_DETECTED"), detected, unknown, status: truncationStatus },
      pass: reasoningLeaks === 0 && externalEffects === 0 && truncationStatus === "pass",
    },
    approvedOnThresholds: false,
  };
  result.approvedOnThresholds =
    result.zodValid.pass &&
    result.intent.pass &&
    result.tool.pass &&
    result.entities.pass &&
    result.stability.pass &&
    result.c6.pass &&
    result.zeroTolerance.pass;
  return result;
}
