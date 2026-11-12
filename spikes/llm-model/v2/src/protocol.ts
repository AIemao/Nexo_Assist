// Protocolo da submitInterpretation (v2/CRITERIA.md, "Protocolo da submitInterpretation").
// Um TurnProtocol por tentativa de turno: registra as chamadas emitidas (argumentos crus), aplica
// a guarda de passo nos hooks do Mastra, registra execuções e aceite, e decide o término.
//
// Premissa de ordem (Mastra 1.81.0, caminho doGenerate): todos os chunks tool-call de um passo
// chegam antes do primeiro beforeToolCall desse passo. O primeiro beforeToolCall SELA a
// composição; um chunk tool-call depois do selo é contado em lateChunks (I5) e torna a decisão
// mais restritiva (nunca menos). A I2, conferida no registro, é a rede de segurança.

import { createTool, validateToolInput } from "@mastra/core/tools";

import { sanitize } from "../../src/run.ts";
import { interpretationSchema } from "../../src/schema.ts";
import { TOOL_INPUT_SCHEMAS } from "../../src/tools.ts";
import { redactToolArgs } from "./leak.ts";
import { SUBMIT_DESCRIPTION } from "./prompt.ts";
import { SUBMIT_TOOL, type AcceptedSubmission, type EmittedCall, type ExecutionEvent, type StepRecord, type StepVerdict } from "./record.ts";

type Loose = Record<string, unknown>;
const asLoose = (value: unknown): Loose => (typeof value === "object" && value !== null ? (value as Loose) : {});

// Decisão pela composição completa de um passo (nomes das chamadas emitidas nele).
export function verdictOf(names: readonly string[]): StepVerdict {
  const submits = names.filter((name) => name === SUBMIT_TOOL).length;
  if (submits >= 2) return "MULTIPLE";
  if (submits === 1 && names.length > 1) return "SAME_STEP";
  return "OK";
}

// Schemas de entrada das tools conhecidas: as quatro de negócio da V1 e a de protocolo.
export const INPUT_SCHEMAS: Record<string, unknown> = { ...TOOL_INPUT_SCHEMAS, [SUBMIT_TOOL]: interpretationSchema };
export const isKnownTool = (name: string) => name in INPUT_SCHEMAS;

// Validade pela função do Mastra (a mesma do ciclo); null para tool desconhecida (sem schema).
// Chamada na CAPTURA, sobre o valor original, antes da remoção de raciocínio (que pode mudar a validade).
export function validityOf(toolName: string, value: unknown): boolean | null {
  if (!isKnownTool(toolName)) return null;
  const result = validateToolInput(INPUT_SCHEMAS[toolName] as never, structuredClone(value), toolName) as { error?: unknown };
  return result.error === undefined;
}

// Resultado de validação recusada pelo Mastra (o execute não rodou).
export function isValidationErrorResult(value: unknown): boolean {
  const v = asLoose(value);
  return v["error"] === true && "validationErrors" in v;
}

// Argumentos crus: o que o modelo emitiu, só decodificado, copiado antes da validação do Mastra.
function rawArgsOf(payload: Loose): unknown {
  const raw = payload["args"] ?? payload["input"];
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return raw;
    }
  } else if (raw !== undefined) {
    value = structuredClone(raw);
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value) && "__mastraMetadata" in value) {
    const { __mastraMetadata: _meta, ...rest } = value as Loose;
    return rest;
  }
  return value;
}

const GUARD_MESSAGE: Record<Exclude<StepVerdict, "OK">, string> = {
  SAME_STEP: "submitInterpretation emitida no mesmo passo que outra chamada: nenhuma chamada deste passo foi executada.",
  MULTIPLE: "Mais de uma submitInterpretation no mesmo passo: nenhuma foi aceita.",
};

export class TurnProtocol {
  readonly emitted: EmittedCall[] = [];
  readonly executions: ExecutionEvent[] = [];
  readonly acceptedSubmissions: AcceptedSubmission[] = [];
  terminal: { step: number; cause: "ACCEPTED" | "VIOLATION" } | null = null;
  leakedInArgs = false;

  private readonly stepRecords: StepRecord[] = [{ index: 0, verdict: null, lateChunks: 0 }];
  private step = 0;
  private finishedSteps = 0;
  private readonly guardRefused = new Set<string>();

  // Tool de protocolo: a execução é o aceite (passou na validação do Mastra e na guarda).
  readonly submitTool = createTool({
    id: SUBMIT_TOOL,
    description: SUBMIT_DESCRIPTION,
    inputSchema: interpretationSchema,
    execute: async (_input, context) => {
      const toolCallId = asLoose(asLoose(context)["agent"])["toolCallId"];
      this.acceptedSubmissions.push({ step: this.step, toolCallId: typeof toolCallId === "string" ? toolCallId : null });
      if (this.terminal === null) this.terminal = { step: this.step, cause: "ACCEPTED" };
      return { status: "ACCEPTED" };
    },
  });

  private namesOf(step: number): string[] {
    return this.emitted.filter((call) => call.step === step).map((call) => call.toolName);
  }

  private current(): StepRecord {
    return this.stepRecords[this.step] as StepRecord;
  }

  // onChunk do agent.generate: só os chunks tool-call interessam.
  readonly onChunk = (chunk: unknown): void => {
    const c = asLoose(chunk);
    if (c["type"] !== "tool-call") return;
    const payload = "payload" in c ? asLoose(c["payload"]) : c;
    const toolName = String(payload["toolName"] ?? "");
    const original = rawArgsOf(payload);
    const validAtCapture = validityOf(toolName, original);
    const redacted = redactToolArgs(toolName, original);
    this.leakedInArgs ||= redacted.leaked;
    const toolCallId = payload["toolCallId"];
    this.emitted.push({
      step: this.step,
      order: this.emitted.length,
      toolCallId: typeof toolCallId === "string" ? toolCallId : null,
      toolName,
      rawArgs: redacted.value,
      validAtCapture,
    });
    const record = this.current();
    if (record.verdict !== null) {
      // Chunk depois do selo: premissa de ordem quebrada (I5). A decisão só pode endurecer.
      record.lateChunks += 1;
      const full = verdictOf(this.namesOf(this.step));
      if (full !== "OK") record.verdict = full;
    }
  };

  // Argumentos do evento: o cru visto pelo hook, com raciocínio removido pela mesma política das
  // emissões (leak.ts); a validade é calculada sobre o valor original, antes da remoção.
  private eventArgs(toolName: string, input: unknown): { args: unknown; validAtCapture: boolean | null } {
    const validAtCapture = validityOf(toolName, input);
    const redacted = redactToolArgs(toolName, input);
    this.leakedInArgs ||= redacted.leaked;
    return { args: redacted.value, validAtCapture };
  }

  private refuse(step: number, toolCallId: string | null, toolName: string, input: unknown, verdict: Exclude<StepVerdict, "OK">) {
    this.guardRefused.add(`${step}|${toolCallId}|${toolName}`);
    this.executions.push({ step, toolCallId, toolName, outcome: "GUARD_REFUSED", ...this.eventArgs(toolName, input) });
    if (this.terminal === null) this.terminal = { step, cause: "VIOLATION" };
    return { proceed: false as const, output: { error: true, code: verdict === "MULTIPLE" ? "SEM_PROTOCOL_MULTIPLE" : "SEM_PROTOCOL_SAME_STEP", message: GUARD_MESSAGE[verdict] } };
  }

  // hooks.beforeToolCall: sela a composição no primeiro hook do passo e aplica a mesma decisão a todos.
  readonly beforeToolCall = (ctx: { toolName: string; input: unknown; context?: unknown }) => {
    const record = this.current();
    if (record.verdict === null) record.verdict = verdictOf(this.namesOf(this.step));
    const toolCallId = asLoose(ctx.context)["toolCallId"];
    const id = typeof toolCallId === "string" ? toolCallId : null;
    if (record.verdict !== "OK") return this.refuse(this.step, id, ctx.toolName, ctx.input, record.verdict);
    return undefined;
  };

  // hooks.afterToolCall: resultado de cada chamada não recusada pela guarda. Erro lançado pelo
  // execute vira THREW (não EXECUTED), com nome e mensagem sanitizados.
  readonly afterToolCall = (ctx: { toolName: string; input: unknown; output?: unknown; error?: unknown; context?: unknown }) => {
    const toolCallId = asLoose(ctx.context)["toolCallId"];
    const id = typeof toolCallId === "string" ? toolCallId : null;
    if (this.guardRefused.has(`${this.step}|${id}|${ctx.toolName}`)) return;
    const base = { step: this.step, toolCallId: id, toolName: ctx.toolName, ...this.eventArgs(ctx.toolName, ctx.input) };
    if (ctx.error !== undefined && ctx.error !== null) {
      const e = asLoose(ctx.error);
      const error = sanitize(`${String(e["name"] ?? "Error")}: ${String(e["message"] ?? ctx.error)}`);
      this.executions.push({ ...base, outcome: "THREW", error });
      return;
    }
    this.executions.push({ ...base, outcome: isValidationErrorResult(ctx.output) ? "MASTRA_REFUSED" : "EXECUTED" });
  };

  readonly hooks = { beforeToolCall: this.beforeToolCall, afterToolCall: this.afterToolCall };

  // onStepFinish: fecha o passo (chega depois das execuções e do stopWhen do passo).
  readonly onStepFinish = (): void => {
    this.finishedSteps += 1;
    this.step += 1;
    this.stepRecords.push({ index: this.step, verdict: null, lateChunks: 0 });
  };

  // stopWhen: encerra com submissão aceita ou passo violado. O maxSteps continua valendo.
  readonly stopWhen = (): boolean => this.terminal !== null;

  // Passos para o registro: os concluídos e, se o turno parou no meio de um, o que tem emissões.
  steps(): StepRecord[] {
    return this.stepRecords.filter((s) => s.index < this.finishedSteps || this.emitted.some((call) => call.step === s.index));
  }
}
