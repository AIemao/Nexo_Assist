import { z } from "zod";

// Cliente HTTP do ticket-service, só do servidor (ADR-013). O ator é montado aqui, nunca vem do
// navegador (contrato HTTP §2.2). O e-mail nunca vai para log nem para mensagem de erro (contrato
// §10.1; README §8).
//
// Retry de transporte (PW-12; contrato v1.5 §7.3): 2 tentativas extras, backoff de 200 ms e 600 ms,
// timeout de 3 s por tentativa, só para 5xx, timeout e erro de conexão; nunca para 4xx.

export const RETRY_BACKOFF_MS = [200, 600] as const;
export const ATTEMPT_TIMEOUT_MS = 3_000;

export interface TicketServiceClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  // Espera do backoff, injetável nos testes.
  sleep?: (ms: number) => Promise<void>;
  attemptTimeoutMs?: number;
}

// DM §3.1; contrato §10.2.
const employeeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.string(),
  department: z.string(),
  role: z.enum(["EMPLOYEE", "ANALYST"]),
});

export type LookupEmployee = z.infer<typeof employeeSchema>;

export type LookupResult =
  | { kind: "found"; employee: LookupEmployee }
  | { kind: "not_found" }
  // Resposta que o BFF não deveria provocar (400, 403, 415, outro 4xx ou corpo fora do contrato).
  | { kind: "rejected"; status: number }
  // 5xx, timeout ou erro de conexão depois das tentativas.
  | { kind: "unavailable" };

export interface TicketServiceClient {
  lookupEmployee(email: string): Promise<LookupResult>;
}

type Attempt = { kind: "response"; status: number; body: unknown } | { kind: "transport_failure" };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createTicketServiceClient(options: TicketServiceClientOptions): TicketServiceClient {
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const sleep = options.sleep ?? defaultSleep;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const base = options.baseUrl.replace(/\/+$/, "");

  async function attempt(path: string, init: RequestInit): Promise<Attempt> {
    try {
      const response = await doFetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(attemptTimeoutMs) });
      const text = await response.text();
      let body: unknown;
      try {
        body = text === "" ? undefined : JSON.parse(text);
      } catch {
        body = undefined;
      }
      return { kind: "response", status: response.status, body };
    } catch {
      // Timeout (AbortSignal) ou erro de conexão. A mensagem não é guardada: pode conter a URL.
      return { kind: "transport_failure" };
    }
  }

  async function withRetry(path: string, init: RequestInit): Promise<Attempt> {
    let last: Attempt = { kind: "transport_failure" };
    for (let index = 0; index <= RETRY_BACKOFF_MS.length; index++) {
      if (index > 0) await sleep(RETRY_BACKOFF_MS[index - 1] ?? 0);
      last = await attempt(path, init);
      const retryable = last.kind === "transport_failure" || last.status >= 500;
      if (!retryable) return last;
    }
    return last;
  }

  return {
    async lookupEmployee(email) {
      // Contrato §10.1: ator SYSTEM, sem X-Actor-Employee-Id; corpo estrito, só o e-mail.
      const result = await withRetry("/employees/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Actor-Type": "SYSTEM" },
        body: JSON.stringify({ email }),
      });
      if (result.kind === "transport_failure" || result.status >= 500) return { kind: "unavailable" };
      if (result.status === 200) {
        const parsed = employeeSchema.safeParse(result.body);
        return parsed.success ? { kind: "found", employee: parsed.data } : { kind: "rejected", status: 200 };
      }
      if (result.status === 404 && isProblem(result.body, "EMPLOYEE_NOT_FOUND")) return { kind: "not_found" };
      return { kind: "rejected", status: result.status };
    },
  };
}

function isProblem(body: unknown, code: string): boolean {
  return typeof body === "object" && body !== null && "code" in body && body.code === code;
}
