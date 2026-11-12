// Formato do registro da V2 (uma linha JSONL por turno). Produzido por v2/src/run.ts e
// v2/src/protocol.ts; pontuado por v2/src/score.ts. Regras em v2/CRITERIA.md.

import type { ContextCheck, ExecCode, ModelCallRecord, RateLimitEvent, SemCode } from "../../src/run-record.ts";

export const SUBMIT_TOOL = "submitInterpretation";

// Códigos novos da V2 (v2/CRITERIA.md, "Falhas do modelo: códigos registrados").
export const PROTOCOL_CODES = [
  "SEM_PROTOCOL_MISSING",
  "SEM_PROTOCOL_NOT_ACCEPTED",
  "SEM_PROTOCOL_MULTIPLE",
  "SEM_PROTOCOL_SAME_STEP",
] as const;
export type ProtocolCode = (typeof PROTOCOL_CODES)[number];
export type V2Code = ExecCode | SemCode | ProtocolCode;

// Uma chamada de tool emitida pelo modelo (chunk tool-call), antes de qualquer validação.
export interface EmittedCall {
  step: number;
  // Ordem global de emissão no turno (0, 1, 2…).
  order: number;
  toolCallId: string | null;
  toolName: string;
  // JSON emitido, só decodificado; conteúdo de raciocínio já removido.
  rawArgs: unknown;
  // validateToolInput sobre o valor ORIGINAL (antes da remoção de raciocínio), na captura.
  // null para nome de tool desconhecido (sem schema).
  validAtCapture: boolean | null;
}

// Decisão da guarda para um passo (v2/CRITERIA.md, "Guarda de passo").
export type StepVerdict = "OK" | "SAME_STEP" | "MULTIPLE";

export interface StepRecord {
  index: number;
  // Decisão tomada no selo (primeiro beforeToolCall do passo); null se nenhum hook rodou no passo.
  verdict: StepVerdict | null;
  // Chunks tool-call chegados depois do selo (quebra da premissa de ordem; I5).
  lateChunks: number;
}

// Resultado de uma chamada, visto pelos hooks do Mastra.
// - EXECUTED: o execute rodou e devolveu; MASTRA_REFUSED: a validação do Mastra recusou a entrada;
// - GUARD_REFUSED: a guarda de passo recusou; THREW: o execute lançou erro (afterToolCall com error).
export interface ExecutionEvent {
  step: number;
  toolCallId: string | null;
  toolName: string;
  outcome: "EXECUTED" | "MASTRA_REFUSED" | "GUARD_REFUSED" | "THREW";
  // Entrada vista pelo hook: o argumento CRU (hook-input.test.ts), com raciocínio removido.
  args: unknown;
  // validateToolInput sobre o ctx.input ORIGINAL (antes da remoção de raciocínio), na captura.
  validAtCapture: boolean | null;
  // Só em THREW: nome e mensagem do erro, sanitizados.
  error?: string;
}

export interface AcceptedSubmission {
  step: number;
  toolCallId: string | null;
}

// Tentativa anterior (interrompida por 429): não é pontuada, mas as invariantes I1–I5 são
// conferidas nela (como turno não concluído).
export interface PreviousAttemptV2 {
  attempt: number;
  error: { code: ExecCode; message: string; status: number | null };
  emitted: EmittedCall[];
  steps: StepRecord[];
  executions: ExecutionEvent[];
  acceptedSubmissions: AcceptedSubmission[];
  terminal: { step: number; cause: "ACCEPTED" | "VIOLATION" } | null;
  toolLog: { tool: string; args: unknown }[];
  calls: ModelCallRecord[];
}

export interface TurnRecordV2 {
  type: "turn";
  experiment: "v2";
  model: string;
  provider: "ollama" | "groq" | "mock";
  caseId: string;
  repetition: number;
  startedAt: string;
  status: "completed" | "execution_error";
  execError: { code: ExecCode; message: string } | null;
  attempts: number;
  rateLimits: RateLimitEvent[];
  // Tentativas anteriores à última; os campos abaixo são da ÚLTIMA, a única pontuada.
  previousAttempts: PreviousAttemptV2[];
  emitted: EmittedCall[];
  steps: StepRecord[];
  executions: ExecutionEvent[];
  acceptedSubmissions: AcceptedSubmission[];
  // Passo em que o turno terminou por submissão aceita ou passo violado (null: nenhum dos dois).
  terminal: { step: number; cause: "ACCEPTED" | "VIOLATION" } | null;
  // Registro próprio das tools falsas da V1 (execuções reais do execute).
  toolLog: { tool: string; args: unknown }[];
  // Texto produzido no turno: não avaliado; só passa pela checagem de vazamento.
  finalText: string;
  reasoning: { separatePresent: boolean; leakedInText: boolean; leakedInArgs: boolean };
  calls: ModelCallRecord[];
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  turnLatencyMs: number;
  finishReason: string | null;
  contextCheck: ContextCheck;
  externalRequests: string[];
}

export interface InvariantViolation {
  invariant: "I1" | "I2" | "I3" | "I4" | "I5";
  detail: string;
}

// Achado que não é violação (ex.: emissão sem evento num turno com EXEC_*): registrado, não aborta.
export interface InvariantDiagnostic {
  invariant: "I4";
  detail: string;
}

export interface RunHeaderV2 {
  type: "run";
  experiment: "v2";
  model: string;
  provider: "ollama" | "groq" | "mock";
  startedAt: string;
  packages: Record<string, string>;
  manifest: { file: string; sha256: string; ok: boolean }[];
  // Ollama: digest da imagem lido de /api/tags antes da rodada (null se não encontrado). Groq: null.
  modelDigest: string | null;
  settings: Record<string, unknown>;
  reasoningControl: string;
  allowedHosts: string[];
  warmup: { latencyMs: number | null; error: string | null; invariantViolations: InvariantViolation[] };
  // Rodada abortada por violação de invariante (defeito do instrumento): sem veredito.
  aborted: { at: string; violations: InvariantViolation[] } | null;
}
