// Formato do registro da V3 (uma linha JSONL por turno). Produzido por v3/src/run.ts; pontuado por
// v3/src/score.ts. Regras em v3/CRITERIA.md.

import type { ContextCheck, ExecCode, ModelCallRecord, RateLimitEvent } from "../../src/run-record.ts";
import type { EmittedCall, ExecutionEvent, StepRecord } from "../../v2/src/record.ts";

export type InvariantId = "I1" | "I2" | "I3" | "I4" | "I5" | "I6" | "I7" | "I8" | "I9" | "I10";

export interface InvariantViolationV3 {
  invariant: InvariantId;
  detail: string;
}

// Achado que não é violação (direção inversa da I3 em turno com EXEC_*; modo alternativo da I10).
export interface InvariantDiagnosticV3 {
  invariant: "I3" | "I10";
  detail: string;
}

// Falha do instrumento registrada pela camada de captura ou por outra camada (latch da tentativa).
export interface InstrumentFailure {
  layer: "monitor" | "captura" | "filtro" | "fidelidade" | "reconciliação" | "orquestração";
  phase: 1 | 2 | null;
  detail: string;
}

// Fase 1: tools de negócio, capturadas pelo TurnProtocol da V2.1 (sem a submitInterpretation).
export interface Phase1Record {
  status: "completed" | "execution_error";
  execError: { code: ExecCode; message: string } | null;
  emitted: EmittedCall[];
  steps: StepRecord[];
  executions: ExecutionEvent[];
  // Registro das tools falsas ao fim da fase 1.
  toolLog: { tool: string; args: unknown }[];
  calls: ModelCallRecord[];
  // Texto de todos os passos da fase 1 (não avaliado), com raciocínio removido.
  text: string;
  reasoning: { separatePresent: boolean; leakedInText: boolean; leakedInArgs: boolean };
  contextCheck: ContextCheck;
  latencyMs: number;
  // Requisições de inferência da fase 1 vistas pela captura (diagnóstico; uma por passo).
  modelRequests: number;
  // Mensagens da transcrição filtrada (contagens; o conteúdo não é gravado).
  transcript: { messages: number; assistantWithToolCalls: number; toolMessages: number };
}

// Requisições da fase 2, vistas pela camada de captura (só booleanos e contagens).
export interface Phase2Request {
  requests: number;
  anyTools: boolean;
  anyToolChoice: boolean;
  allResponseFormat: boolean;
  anyReasoning: boolean;
}

export type Phase2Parse = "OK" | "EMPTY" | "INVALID_JSON" | "LENGTH";

// Fase 2: interpretação, segundo Agent sem tools.
export interface Phase2Record {
  // Lista de passos completa (I4): falso só na fase 2 cancelada por tempo (finishReason "aborted").
  stepsObservable: boolean;
  status: "completed" | "execution_error";
  execError: { code: ExecCode; message: string } | null;
  calls: ModelCallRecord[];
  finishReason: string | null;
  // Texto como veio do provider, com raciocínio removido.
  text: string;
  // Interpretação oficial: JSON.parse(text) (null se vazio, inválido ou finishReason "length"), redigida.
  interpretationRaw: unknown;
  parse: Phase2Parse;
  zodValid: boolean;
  zodIssues: string[];
  // Diagnóstico: o object do Mastra (redigido) e se ele existia.
  mastraObject: unknown;
  mastraObjectPresent: boolean;
  // Diagnóstico: tool calls emitidos na fase 2 (contagem e nomes; nunca argumentos).
  toolCalls: { count: number; names: string[] };
  // Passos de inferência cujo texto é uma interpretação válida (I9).
  validInterpretations: number;
  request: Phase2Request;
  toolLogGrowth: number;
  reasoning: { separatePresent: boolean; leakedInText: boolean; leakedInInterpretation: boolean; leakedInObject: boolean };
  contextCheck: ContextCheck;
  latencyMs: number;
}

export interface FidelityReport {
  violations: string[];
  diagnostics: string[];
}

// Uma tentativa (a última é o registro; as anteriores ficam em previousAttempts).
export interface AttemptV3 {
  attempt: number;
  status: "completed" | "execution_error" | "instrument_defect";
  execError: { code: ExecCode; message: string; status?: number | null } | null;
  phase1: Phase1Record;
  // null quando a fase 2 não foi invocada.
  phase2: Phase2Record | null;
  phase2Invocations: number;
  fidelity: FidelityReport;
  instrumentFailures: InstrumentFailure[];
}

export interface TurnRecordV3 extends AttemptV3 {
  type: "turn";
  experiment: "v3";
  model: string;
  provider: "ollama" | "groq" | "mock";
  caseId: string;
  repetition: number;
  startedAt: string;
  attempts: number;
  rateLimits: RateLimitEvent[];
  previousAttempts: AttemptV3[];
  // Combinação do truncamento das fases invocadas (v3/CRITERIA.md, "Truncamento").
  contextCheck: ContextCheck;
  turnLatencyMs: number;
  externalRequests: string[];
}

export interface RunHeaderV3 {
  type: "run";
  experiment: "v3";
  model: string;
  provider: "ollama" | "groq" | "mock";
  startedAt: string;
  packages: Record<string, string>;
  manifest: { file: string; sha256: string; ok: boolean }[];
  modelDigest: string | null;
  settings: Record<string, unknown>;
  reasoningControl: string;
  allowedHosts: string[];
  warmup: { latencyMs: number | null; error: string | null; invariantViolations: InvariantViolationV3[] };
  // Ganchos de teste usados na rodada (TEST_HOOKS); numa rodada real, nenhum.
  testHooksUsed: string[];
  // Rodada abortada por defeito do instrumento: sem veredito.
  aborted: { at: string; reason: string; violations: InvariantViolationV3[]; failures: InstrumentFailure[] } | null;
}
