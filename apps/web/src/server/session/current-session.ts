import { cookies } from "next/headers";
import { getUnitOfWork } from "../persistence/database";
import type { Session } from "../persistence/session-repository";
import { systemClock } from "../runtime";
import { readSessionCookie, SESSION_COOKIE_NAME } from "./cookie";
import { findValidSession } from "./session-service";

// Helper dos server components: a sessão válida do cookie, ou undefined.
export async function getCurrentSession(): Promise<Session | undefined> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (token === undefined || token === "") return undefined;
  return findValidSession(getUnitOfWork(), token, systemClock);
}

// Helper dos Route Handlers: a sessão válida do cabeçalho Cookie da requisição, ou undefined.
export async function getRequestSession(request: Request): Promise<Session | undefined> {
  const token = readSessionCookie(request.headers.get("cookie"));
  if (token === undefined) return undefined;
  return findValidSession(getUnitOfWork(), token, systemClock);
}
