// Registro compartilhado de erros inesperados (README §12 #22; §8: "Logs sem dados
// sensíveis desnecessários"). Uma linha JSON no stderr com campos permitidos: tipo do erro,
// código do Prisma quando houver, código de erro de sistema do Node quando houver e pilha
// sem as linhas da mensagem. Nunca entram message, meta, cause nem propriedades arbitrárias.
//
// Sem import do Prisma (ADR-008, condição 4): o código do Prisma vem de um leitor injetado
// pela raiz de composição (main.ts, seed/cli.ts). Sem leitor, prismaCode nunca aparece.

// Literal fixo de quem chama: o app (requisição), o servidor HTTP, o encerramento e o seed.
export type ErrorLogContext = "request" | "server" | "shutdown" | "seed";

export type PrismaCodeReader = (error: Error) => string | undefined;

export type ErrorLogger = (context: ErrorLogContext, error: unknown) => void;

export interface ErrorLogRecord {
  event: "unexpected_error";
  context: ErrorLogContext;
  errorType: string;
  prismaCode?: string;
  systemCode?: string;
  stack: string[];
}

const SIMPLE_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const SYSTEM_CODE = /^E[A-Z0-9_]+$/;
const STACK_FRAME = /^\s+at /;

export function toErrorLogRecord(
  error: unknown,
  context: ErrorLogContext,
  readPrismaCode?: PrismaCodeReader,
): ErrorLogRecord {
  // Valor que não é Error: só os campos estruturais obrigatórios, com stack vazia.
  if (!(error instanceof Error)) {
    return { event: "unexpected_error", context, errorType: typeof error, stack: [] };
  }

  const prismaCode = readPrismaCode?.(error);
  const systemCode = readSystemCode(error);

  return {
    event: "unexpected_error",
    context,
    errorType: readErrorType(error),
    ...(prismaCode === undefined ? {} : { prismaCode }),
    ...(systemCode === undefined ? {} : { systemCode }),
    stack: readStackFrames(error),
  };
}

export function createErrorLogger(readPrismaCode?: PrismaCodeReader): ErrorLogger {
  return (context, error) => {
    process.stderr.write(`${JSON.stringify(toErrorLogRecord(error, context, readPrismaCode))}\n`);
  };
}

// Nome do construtor, só se for identificador simples; qualquer outra coisa vira "Error".
function readErrorType(error: Error): string {
  const name: unknown = error.constructor?.name;
  return typeof name === "string" && SIMPLE_IDENTIFIER.test(name) ? name : "Error";
}

// O code de erro de sistema do Node só entra se casar com o formato (EADDRINUSE, ECONNRESET…);
// um code arbitrário (inclusive um valor da consulta) é descartado.
function readSystemCode(error: Error): string | undefined {
  const code: unknown = "code" in error ? error.code : undefined;
  return typeof code === "string" && SYSTEM_CODE.test(code) ? code : undefined;
}

// A pilha do V8 começa com "Nome: mensagem", que pode ocupar várias linhas. As linhas da
// mensagem são descartadas pela contagem (uma mensagem pode conter uma linha que imita um
// quadro), e das restantes só ficam os quadros ("at ...").
function readStackFrames(error: Error): string[] {
  if (typeof error.stack !== "string") return [];
  const messageLines = typeof error.message === "string" ? error.message.split("\n").length : 1;
  return error.stack
    .split("\n")
    .slice(messageLines)
    .filter((line) => STACK_FRAME.test(line))
    .map((line) => line.trim());
}
