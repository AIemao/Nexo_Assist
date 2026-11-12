// Pontuação da V2 (v2/CRITERIA.md, "Avaliação de cada resultado", "Falhas do modelo",
// "Invariantes do instrumento", "Limites de aprovação"). Funções puras: nenhuma E/S.
//
// As regras herdadas (Zod, intenção, tool de negócio, entidades, C6, estabilidade e os limites
// correspondentes) são as do scoreTurn e do aggregate da V1, SEM alteração: a V2 monta uma
// "vista V1" do próprio registro e chama as funções da V1. A V2 só acrescenta o protocolo e as
// invariantes.

import { validateToolInput } from "@mastra/core/tools";

import { BUSINESS_TOOLS, type BusinessTool, type ModelCallRecord, type TurnRecord } from "../../src/run-record.ts";
import { aggregate, scoreTurn, type Aggregate, type ThresholdResult, type TurnScore } from "../../src/score.ts";
import { interpretationSchema } from "../../src/schema.ts";
import type { CasesFile } from "../../src/cases-schema.ts";
import { INPUT_SCHEMAS, isKnownTool, verdictOf } from "./protocol.ts";
import {
  SUBMIT_TOOL,
  type AcceptedSubmission,
  type EmittedCall,
  type ExecutionEvent,
  type InvariantDiagnostic,
  type InvariantViolation,
  type ProtocolCode,
  type StepRecord,
  type TurnRecordV2,
  type V2Code,
} from "./record.ts";

type Case = CasesFile["cases"][number];
const isBusiness = (name: string): name is BusinessTool => (BUSINESS_TOOLS as readonly string[]).includes(name);

// JSON canônico: chaves ordenadas recursivamente (a ordem das chaves não importa; CRITERIA da V1).
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

// Passos violados pela composição COMPLETA das emissões (não pela decisão selada): é o que a I2 confere.
export function violatedSteps(attempt: { emitted: readonly EmittedCall[] }): Set<number> {
  const byStep = new Map<number, string[]>();
  for (const call of attempt.emitted) byStep.set(call.step, [...(byStep.get(call.step) ?? []), call.toolName]);
  return new Set([...byStep].filter(([, names]) => verdictOf(names) !== "OK").map(([step]) => step));
}

const isKnown = isKnownTool;

// Validação do Mastra (a mesma função do ciclo) sobre um argumento: aceita ou não e, se aceita, a
// forma coagida em JSON canônico. Argumento recusado fica na forma crua (não há forma coagida).
// Usada só na B3 (toolLog coagido × evento cru). A validade de emissões e eventos vem da captura.
export function mastraValidation(toolName: string, args: unknown): { valid: boolean; form: string } {
  const result = validateToolInput(INPUT_SCHEMAS[toolName] as never, structuredClone(args), toolName) as { data?: unknown; error?: unknown };
  return result.error === undefined ? { valid: true, form: canonicalJson(result.data) } : { valid: false, form: canonicalJson(args) };
}

const submissions = (record: TurnRecordV2): EmittedCall[] =>
  record.emitted.filter((call) => call.toolName === SUBMIT_TOOL).sort((a, b) => a.order - b.order);

// Submissões emitidas até o passo de término (as posteriores são defeito do instrumento, I1).
const submissionsBeforeEnd = (record: TurnRecordV2): EmittedCall[] =>
  submissions(record).filter((call) => record.terminal === null || call.step <= record.terminal.step);

// Interpretação avaliada: a primeira submissão emitida, se o passo dela não foi violado.
export function evaluatedSubmission(record: TurnRecordV2): EmittedCall | null {
  const first = submissions(record)[0];
  if (first === undefined || violatedSteps(record).has(first.step)) return null;
  return first;
}

// `rejected` como na V1 (argumentos recusados pela validação do Mastra): a validade calculada na
// captura, pela mesma função do Mastra, sobre o valor ORIGINAL (antes da remoção de raciocínio).
// O desfecho registrado no evento é conferido contra a validade na I4 (checagem cruzada).
const rejectedByMastra = (call: EmittedCall): boolean => call.validAtCapture === false;

// Vista V1 do registro da V2, para o scoreTurn da V1.
export function toV1View(record: TurnRecordV2): TurnRecord {
  const evaluated = evaluatedSubmission(record);
  const interpretationRaw = evaluated?.rawArgs ?? null;
  const zod = interpretationSchema.safeParse(interpretationRaw);
  const ordered = [...record.emitted].sort((a, b) => a.order - b.order);
  return {
    type: "turn",
    model: record.model,
    provider: record.provider,
    caseId: record.caseId,
    repetition: record.repetition,
    startedAt: record.startedAt,
    status: record.status,
    execError: record.execError,
    attempts: record.attempts,
    rateLimits: record.rateLimits,
    previousAttempts: [],
    businessToolCalls: ordered
      .filter((call): call is EmittedCall & { toolName: BusinessTool } => isBusiness(call.toolName))
      .map((call) => ({ tool: call.toolName, args: call.rawArgs, rejected: rejectedByMastra(call) })),
    syntheticToolCalls: [],
    otherToolCalls: ordered.filter((call) => !isBusiness(call.toolName) && call.toolName !== SUBMIT_TOOL).map((call) => ({ name: call.toolName, args: call.rawArgs })),
    toolLog: record.toolLog,
    interpretationRaw,
    zodValid: zod.success,
    zodIssues: zod.success ? [] : zod.error.issues.map((issue) => `${issue.path.join(".") || "(raiz)"}: ${issue.message}`),
    finalText: record.finalText,
    reasoning: { separatePresent: record.reasoning.separatePresent, leakedInText: record.reasoning.leakedInText, leakedInInterpretation: record.reasoning.leakedInArgs },
    calls: record.calls,
    totalInputTokens: record.totalInputTokens,
    totalOutputTokens: record.totalOutputTokens,
    turnLatencyMs: record.turnLatencyMs,
    finishReason: record.finishReason,
    contextCheck: record.contextCheck,
    externalRequests: record.externalRequests,
  };
}

export interface TurnScoreV2 {
  caseId: string;
  repetition: number;
  // Pontuação herdada, calculada pelo scoreTurn da V1 sobre a vista V1.
  v1: TurnScore;
  protocolCorrect: boolean;
  submissionsEmitted: number;
  submissionsAccepted: number;
  codes: V2Code[];
}

// v2/CRITERIA.md, "Avaliação de cada resultado".
export function scoreTurnV2(record: TurnRecordV2, testCase: Case): TurnScoreV2 {
  const v1 = scoreTurn(toV1View(record), testCase);
  const counted = submissionsBeforeEnd(record);
  const violated = violatedSteps(record);
  const accepted = record.acceptedSubmissions.length;
  const first = counted[0];
  const executed = v1.execCode === null;

  const protocolCorrect = executed && counted.length === 1 && accepted === 1 && first !== undefined && !violated.has(first.step);

  const protocolCodes: ProtocolCode[] = [];
  if (executed) {
    const sameStep = counted.some((call) => record.emitted.some((other) => other.step === call.step && other.toolName !== SUBMIT_TOOL));
    if (counted.length === 0) protocolCodes.push("SEM_PROTOCOL_MISSING");
    if (counted.length > 0 && accepted === 0) protocolCodes.push("SEM_PROTOCOL_NOT_ACCEPTED");
    if (counted.length > 1) protocolCodes.push("SEM_PROTOCOL_MULTIPLE");
    if (sameStep) protocolCodes.push("SEM_PROTOCOL_SAME_STEP");
  }
  return {
    caseId: record.caseId,
    repetition: record.repetition,
    v1,
    protocolCorrect,
    submissionsEmitted: counted.length,
    submissionsAccepted: accepted,
    codes: [...protocolCodes, ...v1.reasons],
  };
}

// Uma tentativa a reconciliar: a última (o registro) ou uma anterior (interrompida por 429).
export interface AttemptView {
  status: "completed" | "execution_error";
  emitted: readonly EmittedCall[];
  executions: readonly ExecutionEvent[];
  acceptedSubmissions: readonly AcceptedSubmission[];
  toolLog: readonly { tool: string; args: unknown }[];
}

export interface Reconciliation {
  mode: "toolCallId" | "multiset";
  // Violações da I4: invalidam a rodada.
  issues: string[];
  // Achados que não são violação (direção inversa em turno com EXEC_*; contagem por tool).
  diagnostics: string[];
}

function countBy(keys: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const key of keys) m.set(key, (m.get(key) ?? 0) + 1);
  return m;
}

// v2/CRITERIA.md, "Reconciliação" (I4). Implementação nova (não reutiliza a da V1). Compara
// sempre formas da mesma natureza (hook-input.test.ts):
// - emissão × evento (B2 e modo alternativo): os dois são CRUS → JSON canônico cru × cru;
// - toolLog × evento (B3): o toolLog é COAGIDO → forma coagida (validateToolInput) dos dois lados.
export function reconcile(attempt: AttemptView): Reconciliation {
  const issues: string[] = [];
  const diagnostics: string[] = [];
  const completed = attempt.status === "completed";
  // Direção inversa (algo emitido ou registrado sem o evento correspondente): violação só em turno concluído.
  const inverse = (message: string) => (completed ? issues : diagnostics).push(message);

  const known = attempt.emitted.filter((call) => isKnown(call.toolName));
  const events = attempt.executions;
  const formOf = (toolName: string, args: unknown) => mastraValidation(toolName, args).form;

  // Checagem cruzada: o desfecho do evento bate com a validade calculada na captura (valor original).
  for (const e of events) {
    if (!isKnown(e.toolName)) {
      issues.push(`evento de tool desconhecida: ${e.toolName}`);
      continue;
    }
    if (e.outcome === "MASTRA_REFUSED" && e.validAtCapture === true) issues.push(`${e.toolName} (${e.toolCallId}): recusada pelo Mastra, mas validateToolInput aceitou os argumentos na captura`);
    if ((e.outcome === "EXECUTED" || e.outcome === "THREW") && e.validAtCapture === false) issues.push(`${e.toolName} (${e.toolCallId}): executada, mas validateToolInput recusou os argumentos na captura`);
  }

  const keyOf = (step: number, id: string | null) => `${step}|${id}`;
  const idKeys = known.map((call) => keyOf(call.step, call.toolCallId));
  const idsUsable = known.every((call) => call.toolCallId !== null) && new Set(idKeys).size === idKeys.length && events.every((e) => e.toolCallId !== null);

  if (idsUsable) {
    // B1, execução → emissão, e B2: cada evento casa com exatamente uma emissão de mesmo nome, e os
    // argumentos crus são iguais (JSON canônico cru × cru; sem coerção, válidos ou não).
    for (const e of events) {
      const match = known.filter((call) => keyOf(call.step, call.toolCallId) === keyOf(e.step, e.toolCallId) && call.toolName === e.toolName);
      if (match.length !== 1) {
        issues.push(`evento ${e.toolName} (passo ${e.step}, ${e.toolCallId}) sem emissão correspondente`);
        continue;
      }
      if (canonicalJson((match[0] as EmittedCall).rawArgs) !== canonicalJson(e.args)) {
        issues.push(`${e.toolName} (passo ${e.step}, ${e.toolCallId}): argumentos do evento divergem da emissão`);
      }
    }
    // B1, emissão → evento: toda emissão conhecida tem exatamente um evento.
    for (const call of known) {
      const n = events.filter((e) => keyOf(e.step, e.toolCallId) === keyOf(call.step, call.toolCallId) && e.toolName === call.toolName).length;
      if (n === 0) inverse(`emissão ${call.toolName} (passo ${call.step}, ${call.toolCallId}) sem evento`);
      if (n > 1) issues.push(`${n} eventos para a emissão ${call.toolName} (passo ${call.step}, ${call.toolCallId})`);
    }
  } else {
    // Recurso alternativo: multiconjunto nome + JSON canônico CRU (emissão e evento são crus), sem
    // deduplicação (só contagens).
    const emittedCount = countBy(known.map((call) => `${call.toolName}|${canonicalJson(call.rawArgs)}`));
    const eventCount = countBy(events.filter((e) => isKnown(e.toolName)).map((e) => `${e.toolName}|${canonicalJson(e.args)}`));
    for (const key of new Set([...emittedCount.keys(), ...eventCount.keys()])) {
      const emittedN = emittedCount.get(key) ?? 0;
      const eventN = eventCount.get(key) ?? 0;
      if (eventN > emittedN) issues.push(`multiconjunto: ${eventN} evento(s) para ${emittedN} emissão(ões) de ${key.slice(0, 120)}`);
      if (eventN < emittedN) inverse(`multiconjunto: ${emittedN} emissão(ões) e ${eventN} evento(s) de ${key.slice(0, 120)}`);
    }
  }

  // B3: toolLog × execuções de negócio, por multiconjunto da forma coagida. Toda EXECUTED tem registro;
  // registro sem EXECUTED só é aceito se houver THREW equivalente (o execute pode ter registrado e lançado).
  const businessEvents = events.filter((e) => isBusiness(e.toolName));
  const executedCount = countBy(businessEvents.filter((e) => e.outcome === "EXECUTED").map((e) => `${e.toolName}|${formOf(e.toolName, e.args)}`));
  const threwCount = countBy(businessEvents.filter((e) => e.outcome === "THREW").map((e) => `${e.toolName}|${formOf(e.toolName, e.args)}`));
  const logCount = countBy(attempt.toolLog.map((entry) => `${entry.tool}|${formOf(entry.tool, entry.args)}`));
  for (const key of new Set([...executedCount.keys(), ...logCount.keys()])) {
    const executedN = executedCount.get(key) ?? 0;
    const loggedN = logCount.get(key) ?? 0;
    if (executedN > loggedN) issues.push(`toolLog: ${executedN} execução(ões) e ${loggedN} registro(s) de ${key.slice(0, 120)}`);
    if (loggedN > executedN + (threwCount.get(key) ?? 0)) inverse(`toolLog: ${loggedN} registro(s) sem execução correspondente de ${key.slice(0, 120)}`);
  }
  // Contagem por tool: só diagnóstico.
  for (const tool of BUSINESS_TOOLS) {
    const executed = businessEvents.filter((e) => e.outcome === "EXECUTED" && e.toolName === tool).length;
    const logged = attempt.toolLog.filter((entry) => entry.tool === tool).length;
    if (executed !== logged) diagnostics.push(`${tool}: ${executed} execução(ões) vistas pelos hooks e ${logged} no registro das tools falsas`);
  }

  // Aceites × execuções da submitInterpretation.
  const submitExecuted = events.filter((e) => e.outcome === "EXECUTED" && e.toolName === SUBMIT_TOOL).length;
  const accepted = attempt.acceptedSubmissions.length;
  if (submitExecuted > accepted) issues.push(`submitInterpretation: ${submitExecuted} execução(ões) e ${accepted} aceite(s)`);
  if (accepted > submitExecuted) inverse(`submitInterpretation: ${accepted} aceite(s) e ${submitExecuted} execução(ões)`);

  return { mode: idsUsable ? "toolCallId" : "multiset", issues, diagnostics };
}

// I2 numa tentativa: nenhuma tool de negócio executada (ou que lançou depois de começar) em passo violado.
function businessInViolatedSteps(attempt: { emitted: readonly EmittedCall[]; executions: readonly ExecutionEvent[] }): ExecutionEvent[] {
  const violated = violatedSteps(attempt);
  return attempt.executions.filter((e) => (e.outcome === "EXECUTED" || e.outcome === "THREW") && isBusiness(e.toolName) && violated.has(e.step));
}

export interface InvariantReport {
  violations: InvariantViolation[];
  diagnostics: InvariantDiagnostic[];
}

// Uma tentativa com tudo o que as invariantes conferem: a última (o registro) ou uma anterior.
interface AttemptForInvariants extends AttemptView {
  steps: readonly StepRecord[];
  calls: readonly ModelCallRecord[];
  terminal: { step: number; cause: "ACCEPTED" | "VIOLATION" } | null;
}

// I1–I5 numa tentativa. `where` identifica o turno e, nas anteriores, a tentativa.
function attemptInvariants(a: AttemptForInvariants, where: string): InvariantReport {
  const violations: InvariantViolation[] = [];
  const diagnostics: InvariantDiagnostic[] = [];
  const violated = violatedSteps(a);

  // I1: nenhuma geração depois do passo de término (submissão aceita ou passo violado).
  if (a.terminal !== null) {
    const end = a.terminal.step;
    const laterSteps = a.steps.filter((s) => s.index > end).length;
    // Contagem direta pelo índice de cada chamada (não pela posição na lista).
    const laterCalls = a.calls.filter((call) => call.index > end).length;
    const laterEmissions = a.emitted.filter((call) => call.step > end).length;
    if (laterSteps > 0 || laterCalls > 0 || laterEmissions > 0) {
      violations.push({ invariant: "I1", detail: `${where}: ${Math.max(laterSteps, laterCalls)} geração(ões) e ${laterEmissions} emissão(ões) depois do passo ${end}` });
    }
  }

  // I2: nenhuma tool de negócio executada (ou que lançou) em passo violado.
  const bad = businessInViolatedSteps(a);
  if (bad.length > 0) violations.push({ invariant: "I2", detail: `${where}: ${bad.map((e) => `${e.toolName} (passo ${e.step}, ${e.outcome})`).join(", ")} em passo violado` });

  // I3: no máximo uma submissão aceita, nenhuma em passo violado.
  if (a.acceptedSubmissions.length > 1 || a.acceptedSubmissions.some((s) => violated.has(s.step))) {
    violations.push({ invariant: "I3", detail: `${where}: ${a.acceptedSubmissions.length} submissão(ões) aceita(s); passos ${a.acceptedSubmissions.map((s) => s.step).join(", ")}` });
  }

  // I4: reconciliação.
  const r = reconcile(a);
  for (const issue of r.issues) violations.push({ invariant: "I4", detail: `${where}: ${issue}` });
  for (const d of r.diagnostics) diagnostics.push({ invariant: "I4", detail: `${where}: ${d}` });

  // I5: composição selada sem chunks atrasados.
  const late = a.steps.filter((s) => s.lateChunks > 0);
  if (late.length > 0) violations.push({ invariant: "I5", detail: `${where}: chunk tool-call depois do selo nos passos ${late.map((s) => s.index).join(", ")}` });

  return { violations, diagnostics };
}

// v2/CRITERIA.md, "Invariantes do instrumento" (I1–I5), conferidas em cada registro e em cada
// tentativa anterior (interrompida por 429, portanto como turno não concluído).
export function invariantReport(record: TurnRecordV2): InvariantReport {
  const where = `${record.caseId}, repetição ${record.repetition}`;
  const reports = [
    attemptInvariants(record, where),
    ...record.previousAttempts.map((p) => attemptInvariants({ ...p, status: "execution_error" }, `${where} (tentativa ${p.attempt})`)),
  ];
  return { violations: reports.flatMap((r) => r.violations), diagnostics: reports.flatMap((r) => r.diagnostics) };
}

export function checkInvariants(record: TurnRecordV2): InvariantViolation[] {
  return invariantReport(record).violations;
}

export interface AggregateV2 {
  // Limites herdados, calculados pelo aggregate da V1 sobre as pontuações herdadas.
  v1: Aggregate;
  protocol: ThresholdResult;
  approvedOnThresholds: boolean;
}

// v2/CRITERIA.md, "Limites de aprovação". Só para rodadas completas e sem violação de invariante.
export function aggregateV2(cases: readonly Case[], scores: readonly TurnScoreV2[]): AggregateV2 {
  const v1 = aggregate(cases, scores.map((s) => s.v1));
  const protocolCount = scores.filter((s) => s.protocolCorrect).length;
  const protocol = { count: protocolCount, required: 17, pass: protocolCount >= 17 };
  return { v1, protocol, approvedOnThresholds: v1.approvedOnThresholds && protocol.pass };
}
