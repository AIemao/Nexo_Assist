// Registro de erros do web (README §8: "Logs sem dados sensíveis desnecessários"; padrão do
// ticket-service, README §12 #22). Uma linha JSON no stderr só com campos permitidos e literais
// fixos de quem chama. Nunca a mensagem do erro, o corpo da requisição nem o e-mail.

export type ErrorLogContext = "login" | "logout" | "session";

export interface ErrorLogRecord {
  event: "unexpected_error";
  context: ErrorLogContext;
  errorType: string;
  status?: number;
}

export type ErrorLogger = (record: Omit<ErrorLogRecord, "event">) => void;

const SIMPLE_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// Nome do construtor do erro, só se for identificador simples.
export function errorTypeOf(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const name: unknown = error.constructor?.name;
  return typeof name === "string" && SIMPLE_IDENTIFIER.test(name) ? name : "Error";
}

export const logError: ErrorLogger = (record) => {
  const line: ErrorLogRecord = { event: "unexpected_error", ...record };
  process.stderr.write(`${JSON.stringify(line)}\n`);
};
