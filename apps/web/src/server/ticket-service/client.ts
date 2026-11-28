import { PRIORITIES, TICKET_CATEGORIES, TICKET_STATUSES, TICKET_TYPES } from "@nexo/contracts";
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

// Ator das leituras do funcionário (contrato §7.1 e §7.2): só EMPLOYEE, com o id da sessão. Montado
// pelo código; o cliente não recebe cabeçalhos de fora.
export interface EmployeeActor {
  employeeId: string;
}

// Contrato §8.2: item da listagem, em resumo. currentDueAt e isOverdue vêm prontos do ticket-service
// (DM §7.2: o web não recalcula). Campos extras da resposta são ignorados.
const ticketSummaryShape = z.object({
  id: z.string().min(1),
  type: z.enum(TICKET_TYPES),
  title: z.string(),
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(PRIORITIES),
  status: z.enum(TICKET_STATUSES),
  createdAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: z.string().optional(),
  currentDueAt: z.string(),
  isOverdue: z.boolean().nullable(),
});

// Regra do status (contrato §8.2 e §12; DM §3.2 e §8.5.2): resolvedAt existe se, e só se, o status é
// RESOLVED; isOverdue é null exatamente em RESOLVED e true ou false nos demais. Resposta que viola a
// regra está fora do contrato (defeito do BFF).
function statusRule(
  ticket: { status: string; resolvedAt?: string | undefined; isOverdue: boolean | null },
  ctx: z.RefinementCtx,
): void {
  const resolved = ticket.status === "RESOLVED";
  if (resolved !== (ticket.resolvedAt !== undefined)) {
    ctx.addIssue({ code: "custom", path: ["resolvedAt"], message: "resolvedAt existe se, e só se, o status é RESOLVED" });
  }
  if (resolved !== (ticket.isOverdue === null)) {
    ctx.addIssue({ code: "custom", path: ["isOverdue"], message: "isOverdue é null exatamente em RESOLVED" });
  }
}

const ticketSummarySchema = ticketSummaryShape.superRefine(statusRule);

const ticketListSchema = z.object({ tickets: z.array(ticketSummarySchema) });

// Contrato §9.1: o objeto ticket do DM §3.2, sem envelope, mais currentDueAt e isOverdue. Só os
// campos que o web usa são validados; os demais da resposta são ignorados. Mesma regra do status.
const ticketDetailSchema = ticketSummaryShape.extend({ description: z.string() }).superRefine(statusRule);

export type TicketSummary = z.infer<typeof ticketSummarySchema>;
export type TicketDetail = z.infer<typeof ticketDetailSchema>;

export type ListTicketsResult =
  | { kind: "ok"; tickets: TicketSummary[] }
  | { kind: "rejected"; status: number }
  | { kind: "unavailable" };

export type ViewTicketResult =
  | { kind: "found"; ticket: TicketDetail }
  // Contrato §9.2: 404 TICKET_NOT_FOUND, idêntico para inexistente, alheio e malformado.
  | { kind: "not_found" }
  | { kind: "rejected"; status: number }
  | { kind: "unavailable" };

export interface TicketServiceClient {
  lookupEmployee(email: string): Promise<LookupResult>;
  listMyTickets(actor: EmployeeActor): Promise<ListTicketsResult>;
  viewTicket(actor: EmployeeActor, ticketId: string): Promise<ViewTicketResult>;
}

// Contrato §2.2 e §7.1: os dois cabeçalhos do ator EMPLOYEE, construídos do zero a cada chamada.
function employeeHeaders(actor: EmployeeActor): Record<string, string> {
  return { "X-Actor-Type": "EMPLOYEE", "X-Actor-Employee-Id": actor.employeeId };
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

    async listMyTickets(actor) {
      // Contrato §8: GET /tickets, sem parâmetros de consulta.
      const result = await withRetry("/tickets", { method: "GET", headers: employeeHeaders(actor) });
      if (result.kind === "transport_failure" || result.status >= 500) return { kind: "unavailable" };
      if (result.status === 200) {
        const parsed = ticketListSchema.safeParse(result.body);
        return parsed.success ? { kind: "ok", tickets: parsed.data.tickets } : { kind: "rejected", status: 200 };
      }
      return { kind: "rejected", status: result.status };
    },

    async viewTicket(actor, ticketId) {
      // Contrato §9: GET /tickets/{ticketId}, com o id codificado no caminho.
      const result = await withRetry(`/tickets/${encodeURIComponent(ticketId)}`, {
        method: "GET",
        headers: employeeHeaders(actor),
      });
      if (result.kind === "transport_failure" || result.status >= 500) return { kind: "unavailable" };
      if (result.status === 200) {
        const parsed = ticketDetailSchema.safeParse(result.body);
        return parsed.success ? { kind: "found", ticket: parsed.data } : { kind: "rejected", status: 200 };
      }
      // Só o código do contrato vale como negação; um 404 com outro corpo é defeito do BFF.
      if (result.status === 404 && isProblem(result.body, "TICKET_NOT_FOUND")) return { kind: "not_found" };
      return { kind: "rejected", status: result.status };
    },
  };
}

function isProblem(body: unknown, code: string): boolean {
  return typeof body === "object" && body !== null && "code" in body && body.code === code;
}
