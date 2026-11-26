import { errorTypeOf } from "../observability/error-log";
import { expiredSessionCookie, readSessionCookie } from "../session/cookie";
import { revokeSession } from "../session/session-service";
import type { AuthDeps } from "./deps";

// POST /api/logout (ADR-012): revoga a sessão do cookie, se houver, e expira o cookie. Idempotente:
// 204 com ou sem sessão. Exceção inesperada: 500 sem corpo e sem Set-Cookie (a sessão pode não ter
// sido revogada; o cookie não é apagado para não esconder isso), com registro de context e errorType.
export async function handleLogout(
  request: Request,
  deps: Pick<AuthDeps, "unitOfWork" | "clock" | "logError">,
): Promise<Response> {
  try {
    const token = readSessionCookie(request.headers.get("cookie"));
    if (token !== undefined) await revokeSession(deps.unitOfWork, token, deps.clock);
    return new Response(null, { status: 204, headers: { "Set-Cookie": expiredSessionCookie() } });
  } catch (error) {
    deps.logError({ context: "logout", errorType: errorTypeOf(error) });
    return new Response(null, { status: 500 });
  }
}
