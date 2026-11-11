// Formato do registro de execução (uma linha JSONL por turno) e códigos de falha.
// Compartilhado entre src/run.ts (produz) e src/score.ts (pontua). Fase 2a do spike do
// ADR-009; as regras de pontuação estão no CRITERIA.md (congelado em 2026-11-11).

// CRITERIA.md, "Erros: semânticos e de execução".
export const EXEC_CODES = [
  "EXEC_PROVIDER_ERROR",
  "EXEC_TIMEOUT",
  "EXEC_RATE_LIMIT",
  "EXEC_QUOTA",
  "EXEC_FRAMEWORK",
  "EXEC_CONTEXT_TRUNCATED",
  "EXEC_EXTERNAL_EFFECT",
] as const;
export type ExecCode = (typeof EXEC_CODES)[number];

export const SEM_CODES = [
  "SEM_INVALID_INTERPRETATION",
  "SEM_WRONG_INTENT",
  "SEM_WRONG_TOOL",
  "SEM_WRONG_TOOL_ARGS",
  "SEM_WRONG_ENTITIES",
  "SEM_WRONG_MISSING_FIELDS",
  "SEM_REASONING_LEAK",
] as const;
export type SemCode = (typeof SEM_CODES)[number];

// CRITERIA.md, "Configuração": entrada máxima de 7680 tokens; saída máxima de 512.
export const INPUT_TOKEN_BUDGET = 7680;
export const OUTPUT_TOKEN_LIMIT = 512;

export const BUSINESS_TOOLS = ["searchArticles", "listMyTickets", "proposeTicketDraft", "requestHandoff"] as const;
export type BusinessTool = (typeof BUSINESS_TOOLS)[number];

export interface BusinessToolCall {
  tool: BusinessTool;
  args: unknown;
  // Recusada pela validação de entrada do Mastra (o execute da tool falsa não rodou).
  rejected: boolean;
}

// Uma chamada ao modelo dentro do turno (um passo do agent).
export interface ModelCallRecord {
  index: number;
  // Tokens informados pelo provider; null quando o provider não informa.
  inputTokens: number | null;
  outputTokens: number | null;
  // Tempo entre o fim do passo anterior (ou o início do turno) e o fim deste passo.
  latencyMs: number;
  finishReason: string | null;
}

// Um 429 recebido. Nenhum cabeçalho é gravado: do Retry-After fica só o valor em segundos, e os
// x-ratelimit-* (limit, remaining, reset) são descartados (descrevem a conta).
export interface RateLimitEvent {
  attempt: number;
  at: string;
  status: number | null;
  code: ExecCode;
  daily: boolean;
  retryAfterSeconds: number | null;
  // Espera antes da próxima tentativa; null quando não há próxima (cota diária ou última tentativa).
  waitSeconds: number | null;
}

// Estado da verificação de truncamento de um turno (decisão do autor, 2026-11-11):
// - NOT_DETECTED: verificação aprovada, dentro das limitações documentadas no README;
// - DETECTED: tokens de entrada informados acima do orçamento (reprova: EXEC_CONTEXT_TRUNCATED);
// - UNKNOWN: não verificável (tokens não informados, turno não executado) ou indício
//   heurístico de corte silencioso. Inconclusivo: o agregado não aprova o requisito.
export type TruncationStatus = "NOT_DETECTED" | "DETECTED" | "UNKNOWN";

export interface ContextCheck {
  status: TruncationStatus;
  budget: number;
  maxReportedInputTokens: number | null;
  // Estimativa local por caracteres (prompt + schemas das tools + mensagens), só indício.
  estimatedInputTokens: number;
  // Alguma chamada informou mais tokens de entrada que o orçamento (definição do CRITERIA.md).
  overBudget: boolean;
  // Tokens informados muito abaixo da estimativa: indício de corte silencioso (não reprova sozinho).
  suspectedSilentTruncation: boolean;
  // O provider não informou tokens de entrada em alguma chamada: o orçamento não pôde ser conferido.
  unverified: boolean;
}

// Tentativa anterior de um turno, interrompida por um erro que levou a nova tentativa (ex.: 429).
// Mantém o próprio registro de chamadas; NÃO entra na pontuação, que usa só a última tentativa.
export interface PreviousAttempt {
  attempt: number;
  error: { code: ExecCode; message: string; status: number | null };
  businessToolCalls: BusinessToolCall[];
  toolLog: { tool: string; args: unknown }[];
  calls: ModelCallRecord[];
}

export interface TurnRecord {
  type: "turn";
  model: string;
  provider: "ollama" | "groq" | "mock";
  caseId: string;
  repetition: number;
  startedAt: string;
  // "completed": o turno terminou (certo ou errado); "execution_error": não terminou.
  status: "completed" | "execution_error";
  execError: { code: ExecCode; message: string } | null;
  attempts: number;
  rateLimits: RateLimitEvent[];
  // Tentativas anteriores à última (vazio quando o turno concluiu na primeira). Os campos
  // abaixo são da ÚLTIMA tentativa, a única pontuada.
  previousAttempts: PreviousAttempt[];
  businessToolCalls: BusinessToolCall[];
  // Tool sintética de saída estruturada do Groq (`json`, `json_1`…): fora da métrica de tool.
  syntheticToolCalls: { name: string }[];
  // Qualquer outro nome de tool chamado pelo modelo (conta como tool incorreta).
  otherToolCalls: { name: string; args: unknown }[];
  // Registro das tools falsas (execuções reais do execute).
  toolLog: { tool: string; args: unknown }[];
  interpretationRaw: unknown;
  zodValid: boolean;
  zodIssues: string[];
  // Texto final; trechos de raciocínio detectados são removidos antes de gravar.
  finalText: string;
  reasoning: {
    // O provider devolveu raciocínio em campo separado (descartado; não é vazamento).
    separatePresent: boolean;
    // Raciocínio detectado no texto final ou na interpretação (vazamento; conteúdo removido).
    leakedInText: boolean;
    leakedInInterpretation: boolean;
  };
  calls: ModelCallRecord[];
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  turnLatencyMs: number;
  finishReason: string | null;
  contextCheck: ContextCheck;
  // Requisições de rede feitas durante o turno para hosts que não são o endpoint do modelo.
  externalRequests: string[];
}

export interface RunHeader {
  type: "run";
  model: string;
  provider: "ollama" | "groq" | "mock";
  startedAt: string;
  packages: Record<string, string>;
  manifest: { file: string; sha256: string; ok: boolean }[];
  settings: Record<string, unknown>;
  reasoningControl: string;
  allowedHosts: string[];
  warmup: { latencyMs: number | null; error: string | null };
}
