import { z } from "zod";
import { errorTypeOf } from "../observability/error-log";
import { createSessionIn } from "../session/session-service";
import { sessionCookie } from "../session/cookie";
import type { AuthDeps } from "./deps";

// POST /api/login (ADR-012 e nota de 2026-11-22; contrato HTTP §10). Login simulado: qualquer senha
// não vazia vale, sem verificação contra segredo. O login não cria conversa (DM v2.19 §3.5).
export const LOGIN_MESSAGES = {
  invalidBody: "Informe o e-mail e a senha.",
  invalidCredentials: "E-mail ou senha inválidos.",
  analystUnavailable: "O acesso de analista ainda não está disponível.",
  unavailable: "Sistema instável, tente de novo.",
  internal: "Erro interno. Tente de novo mais tarde.",
} as const;

// E-mail: string, como no contrato HTTP §10.1 e no schema do POST /employees/lookup (que só exige
// string); aqui também não vazio depois de trim, para nem chamar o ticket-service. O formato não é
// validado: o contrato não o valida. A senha é obrigatória e não vazia (nota de 2026-11-22 no ADR-012).
const loginBodySchema = z.object({
  email: z.string().refine((email) => email.trim() !== ""),
  password: z.string().min(1),
});

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers });
}

// Exceção inesperada (por exemplo, falha do banco): 500 genérico, com registro só de context e
// errorType; nunca a mensagem do erro nem o e-mail.
export async function handleLogin(request: Request, deps: AuthDeps): Promise<Response> {
  try {
    return await login(request, deps);
  } catch (error) {
    deps.logError({ context: "login", errorType: errorTypeOf(error) });
    return json(500, { message: LOGIN_MESSAGES.internal });
  }
}

async function login(request: Request, deps: AuthDeps): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { message: LOGIN_MESSAGES.invalidBody });
  }
  const body = loginBodySchema.safeParse(raw);
  if (!body.success) return json(400, { message: LOGIN_MESSAGES.invalidBody });

  const lookup = await deps.ticketService.lookupEmployee(body.data.email);
  switch (lookup.kind) {
    case "not_found":
      return json(401, { message: LOGIN_MESSAGES.invalidCredentials });
    case "unavailable":
      return json(503, { message: LOGIN_MESSAGES.unavailable });
    case "rejected":
      // 400, 403 ou 415 do ticket-service indicam defeito do BFF. O registro não leva o e-mail.
      deps.logError({ context: "login", errorType: "TicketServiceRejected", status: lookup.status });
      return json(500, { message: LOGIN_MESSAGES.internal });
    case "found":
      break;
  }

  const employee = lookup.employee;
  // Nota de 2026-11-22 no ADR-012: no Bloco 4, o analista não recebe sessão.
  if (employee.role !== "EMPLOYEE") return json(403, { message: LOGIN_MESSAGES.analystUnavailable });

  const { token, conversationId } = await deps.unitOfWork.execute(async (repos) => {
    const created = await createSessionIn(repos, employee, deps);
    const open = await repos.conversations.findOpenByOwner(employee.id);
    return { token: created.token, conversationId: open?.id ?? null };
  });

  return json(
    200,
    { employee: { id: employee.id, name: employee.name }, conversationId },
    { "Set-Cookie": sessionCookie(token) },
  );
}
