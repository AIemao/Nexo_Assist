import type { Session } from "../persistence/session-repository";
import type { UnitOfWork, UnitOfWorkRepositories } from "../persistence/unit-of-work";
import type { Clock, IdGenerator } from "../runtime";
import { SESSION_DURATION_MS } from "./cookie";
import { generateSessionToken, hashSessionToken, isWellFormedToken } from "./token";

// ADR-012 e nota de 2026-11-22.
const CLEANUP_GRACE_MS = 24 * 60 * 60 * 1000;

export interface SessionEmployee {
  id: string;
  name: string;
  role: string;
}

// Cria a sessão dentro de uma Unit of Work já aberta (o login junta a limpeza, a criação e a leitura
// da conversa numa única transação). Devolve o token, que só sai no cookie.
export async function createSessionIn(
  repos: Pick<UnitOfWorkRepositories, "sessions">,
  employee: SessionEmployee,
  deps: { clock: Clock; ids: IdGenerator },
): Promise<{ token: string; session: Session }> {
  const now = deps.clock.now();
  // Limpeza no login: só as expiradas há mais de 1 dia; uma sessão válida nunca é apagada.
  await repos.sessions.deleteExpiredBefore(new Date(now.getTime() - CLEANUP_GRACE_MS).toISOString());
  const token = generateSessionToken();
  const session = await repos.sessions.create({
    id: deps.ids.generate(),
    tokenHash: hashSessionToken(token),
    employeeId: employee.id,
    role: employee.role,
    name: employee.name,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_DURATION_MS).toISOString(),
  });
  return { token, session };
}

// Sessão válida: existe, não foi revogada e expiresAt é posterior ao instante atual.
export async function findValidSession(unitOfWork: UnitOfWork, token: string, clock: Clock): Promise<Session | undefined> {
  if (!isWellFormedToken(token)) return undefined;
  const session = await unitOfWork.execute(({ sessions }) => sessions.findByTokenHash(hashSessionToken(token)));
  if (session === undefined || session.revokedAt !== undefined) return undefined;
  return Date.parse(session.expiresAt) > clock.now().getTime() ? session : undefined;
}

// Logout: grava revokedAt; a linha fica.
export async function revokeSession(unitOfWork: UnitOfWork, token: string, clock: Clock): Promise<boolean> {
  if (!isWellFormedToken(token)) return false;
  const revokedAt = clock.now().toISOString();
  return unitOfWork.execute(({ sessions }) => sessions.revoke(hashSessionToken(token), revokedAt));
}
