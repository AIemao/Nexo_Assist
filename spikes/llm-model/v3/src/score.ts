// Pontuação, truncamento combinado e invariantes da V3 (v3/CRITERIA.md, "Avaliação de cada
// resultado", "Truncamento", "Invariantes do instrumento", "Limites de aprovação"). Funções puras.
//
// As regras de pontuação são as do scoreTurn e do aggregate da V1, SEM alteração, sobre uma
// "vista V1" do registro da V3. Não há limite de protocolo, e nenhum evento de submissão é fabricado.

import { BUSINESS_TOOLS, INPUT_TOKEN_BUDGET, type BusinessTool, type ContextCheck, type ExecCode, type ModelCallRecord, type SemCode, type TurnRecord } from "../../src/run-record.ts";
import { aggregate, scoreTurn, type Aggregate, type TurnScore } from "../../src/score.ts";
import type { CasesFile } from "../../src/cases-schema.ts";
import { NON_INFERENCE_FINISH_REASONS } from "../../v2/src/run.ts";
import { reconcile } from "../../v2/src/score.ts";
import type { AttemptV3, InvariantDiagnosticV3, InvariantViolationV3, TurnRecordV3 } from "./record.ts";

type Case = CasesFile["cases"][number];
const isBusiness = (name: string): name is BusinessTool => (BUSINESS_TOOLS as readonly string[]).includes(name);

// Iguais aos da V1 e da V2.1 (MAX_STEPS da fase 1; a fase 2 tem um passo).
const PHASE1_MAX_INFERENCE = 5;
const PHASE2_MAX_INFERENCE = 1;

export const inferenceSteps = (calls: readonly ModelCallRecord[]) => calls.filter((c) => !NON_INFERENCE_FINISH_REASONS.includes(c.finishReason ?? ""));

// v3/CRITERIA.md, "Truncamento": só as fases invocadas entram; fase não executada fica fora (null);
// fase invocada sem medição já chega UNKNOWN pela regra da V2.1 (contextCheckFromCalls).
export function combineContextChecks(phase1: ContextCheck, phase2: ContextCheck | null): ContextCheck {
  const invoked = phase2 === null ? [phase1] : [phase1, phase2];
  const status = invoked.some((c) => c.status === "DETECTED") ? "DETECTED" : invoked.some((c) => c.status === "UNKNOWN") ? "UNKNOWN" : "NOT_DETECTED";
  const reported = invoked.map((c) => c.maxReportedInputTokens).filter((v): v is number => v !== null);
  return {
    status,
    budget: INPUT_TOKEN_BUDGET,
    maxReportedInputTokens: reported.length > 0 ? Math.max(...reported) : null,
    estimatedInputTokens: Math.max(...invoked.map((c) => c.estimatedInputTokens)),
    overBudget: invoked.some((c) => c.overBudget),
    suspectedSilentTruncation: invoked.some((c) => c.suspectedSilentTruncation),
    unverified: invoked.some((c) => c.unverified),
  };
}

// ---------------------------------------------------------------------------
// Invariantes I1–I10, numa tentativa.

export interface InvariantReportV3 {
  violations: InvariantViolationV3[];
  diagnostics: InvariantDiagnosticV3[];
}

function attemptInvariants(a: AttemptV3, where: string): InvariantReportV3 {
  const violations: InvariantViolationV3[] = [];
  const diagnostics: InvariantDiagnosticV3[] = [];
  const v = (invariant: InvariantViolationV3["invariant"], detail: string) => violations.push({ invariant, detail: `${where}: ${detail}` });
  const p1 = a.phase1;
  const p2 = a.phase2;

  // I1: nenhum chunk tool-call depois do selo do TurnProtocol (I5 da V2.1).
  const late = p1.steps.filter((s) => s.lateChunks > 0);
  if (late.length > 0) v("I1", `chunk tool-call depois do selo nos passos ${late.map((s) => s.index).join(", ")} da fase 1`);

  // I2: no máximo 5 passos de inferência na fase 1.
  const n1 = inferenceSteps(p1.calls).length;
  if (n1 > PHASE1_MAX_INFERENCE) v("I2", `${n1} passos de inferência na fase 1`);

  // I3: reconciliação da fase 1 (reconcile da V2.1, sem aceites).
  const r = reconcile({ status: p1.status, emitted: p1.emitted, executions: p1.executions, acceptedSubmissions: [], toolLog: p1.toolLog });
  for (const issue of r.issues) v("I3", issue);
  for (const d of r.diagnostics) diagnostics.push({ invariant: "I3", detail: `${where}: ${d}` });

  // I7: a fase 2 roda exatamente uma vez, exceto se a fase 1 terminou em EXEC_*.
  const expected = p1.status === "completed" ? 1 : 0;
  if (a.phase2Invocations !== expected || (p2 === null) !== (a.phase2Invocations === 0)) {
    v("I7", `fase 2 invocada ${a.phase2Invocations} vez(es); esperado ${expected} (fase 1 ${p1.status})`);
  }

  if (p2 !== null) {
    const n2 = inferenceSteps(p2.calls).length;
    // I4: toda requisição da fase 2 capturada. Com a lista de passos completa: capturas = total de
    // passos (inferência, retry e error); cancelada ("aborted") ou sem passos observáveis: capturas ≥ passos.
    const steps2 = p2.calls.length;
    const captured = p2.request.requests;
    if (p2.stepsObservable ? captured !== steps2 : captured < steps2) v("I4", `${captured} requisição(ões) da fase 2 capturada(s) para ${steps2} passo(s) (${p2.stepsObservable ? "igualdade" : "mínimo"})`);
    if (p2.request.anyTools) v("I4", "requisição da fase 2 com tools");
    if (p2.request.anyToolChoice) v("I4", "requisição da fase 2 com tool_choice");
    if (p2.request.requests > 0 && !p2.request.allResponseFormat) v("I4", "requisição da fase 2 sem response_format");
    // I5: no máximo um passo de inferência na fase 2.
    if (n2 > PHASE2_MAX_INFERENCE) v("I5", `${n2} passos de inferência na fase 2`);
    // I6: nenhuma execução de tool durante a fase 2.
    if (p2.toolLogGrowth !== 0) v("I6", `toolLog cresceu ${p2.toolLogGrowth} durante a fase 2`);
    // I8: nenhum raciocínio no corpo da fase 2.
    if (p2.request.anyReasoning) v("I8", "raciocínio no corpo de uma requisição da fase 2");
    // I9: no máximo uma interpretação válida.
    if (p2.validInterpretations > 1) v("I9", `${p2.validInterpretations} interpretações válidas na fase 2`);
  }

  // I10: transcrição fiel (comparações A e B).
  for (const issue of a.fidelity.violations) v("I10", issue);
  for (const d of a.fidelity.diagnostics) diagnostics.push({ invariant: "I10", detail: `${where}: ${d}` });

  return { violations, diagnostics };
}

// Em cada registro e em cada tentativa anterior (interrompida por 429).
export function invariantReportV3(record: TurnRecordV3): InvariantReportV3 {
  const where = `${record.caseId}, repetição ${record.repetition}`;
  const reports = [attemptInvariants(record, where), ...record.previousAttempts.map((p) => attemptInvariants(p, `${where} (tentativa ${p.attempt})`))];
  return { violations: reports.flatMap((r) => r.violations), diagnostics: reports.flatMap((r) => r.diagnostics) };
}

export function checkInvariantsV3(record: TurnRecordV3): InvariantViolationV3[] {
  return invariantReportV3(record).violations;
}

// ---------------------------------------------------------------------------
// Vista V1 e pontuação.

const sumOrNull = (values: (number | null)[]) => (values.some((x) => x !== null) ? values.reduce<number>((s, x) => s + (x ?? 0), 0) : null);

export function toV1View(record: TurnRecordV3): TurnRecord {
  const p1 = record.phase1;
  const p2 = record.phase2;
  const ordered = [...p1.emitted].sort((a, b) => a.order - b.order);
  const interpretationRaw = p2?.interpretationRaw ?? null;
  return {
    type: "turn",
    model: record.model,
    provider: record.provider,
    caseId: record.caseId,
    repetition: record.repetition,
    startedAt: record.startedAt,
    status: record.status === "completed" ? "completed" : "execution_error",
    execError: record.execError === null ? null : { code: record.execError.code, message: record.execError.message },
    attempts: record.attempts,
    rateLimits: record.rateLimits,
    previousAttempts: [],
    businessToolCalls: ordered
      .filter((call) => isBusiness(call.toolName))
      .map((call) => ({ tool: call.toolName as BusinessTool, args: call.rawArgs, rejected: call.validAtCapture === false })),
    syntheticToolCalls: [],
    // Só a fase 1: tool call da fase 2 é diagnóstico, nunca SEM_WRONG_TOOL.
    otherToolCalls: ordered.filter((call) => !isBusiness(call.toolName)).map((call) => ({ name: call.toolName, args: call.rawArgs })),
    toolLog: p1.toolLog,
    interpretationRaw,
    zodValid: p2?.zodValid ?? false,
    zodIssues: p2?.zodIssues ?? [],
    finalText: p1.text,
    reasoning: {
      separatePresent: p1.reasoning.separatePresent || (p2?.reasoning.separatePresent ?? false),
      leakedInText: p1.reasoning.leakedInText || (p2?.reasoning.leakedInText ?? false),
      leakedInInterpretation: p1.reasoning.leakedInArgs || (p2?.reasoning.leakedInInterpretation ?? false) || (p2?.reasoning.leakedInObject ?? false),
    },
    calls: [...p1.calls, ...(p2?.calls ?? [])],
    totalInputTokens: sumOrNull([...p1.calls, ...(p2?.calls ?? [])].map((c) => c.inputTokens)),
    totalOutputTokens: sumOrNull([...p1.calls, ...(p2?.calls ?? [])].map((c) => c.outputTokens)),
    turnLatencyMs: record.turnLatencyMs,
    finishReason: p2?.finishReason ?? null,
    contextCheck: record.contextCheck,
    externalRequests: record.externalRequests,
  };
}

export interface TurnScoreV3 {
  caseId: string;
  repetition: number;
  // Pontuação calculada pelo scoreTurn da V1 sobre a vista V1.
  v1: TurnScore;
  codes: (ExecCode | SemCode)[];
  // Diagnósticos (não pontuam).
  phase2ToolCalls: number;
  mastraObjectPresent: boolean;
  phase2Parse: string | null;
}

export function scoreTurnV3(record: TurnRecordV3, testCase: Case): TurnScoreV3 {
  const v1 = scoreTurn(toV1View(record), testCase);
  return {
    caseId: record.caseId,
    repetition: record.repetition,
    v1,
    codes: v1.reasons,
    phase2ToolCalls: record.phase2?.toolCalls.count ?? 0,
    mastraObjectPresent: record.phase2?.mastraObjectPresent ?? false,
    phase2Parse: record.phase2?.parse ?? null,
  };
}

// Limites da V2.1 sem o de protocolo: o aggregate da V1, sem alteração.
export function aggregateV3(cases: readonly Case[], scores: readonly TurnScoreV3[]): Aggregate {
  return aggregate(cases, scores.map((s) => s.v1));
}
