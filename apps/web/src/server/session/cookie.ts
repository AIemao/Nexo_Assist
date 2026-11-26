// Cookie da sessão (ADR-012 e nota de 2026-11-22): HttpOnly, SameSite=Lax, Path=/, Secure sempre e
// Max-Age igual à expiração absoluta de 8 horas. Sem SESSION_COOKIE_SECURE: o teste manual do
// Secure em http://localhost é do autor.
export const SESSION_COOKIE_NAME = "nexo_session";
export const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

const ATTRIBUTES = "Path=/; HttpOnly; Secure; SameSite=Lax";

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}; Max-Age=${SESSION_DURATION_MS / 1000}; ${ATTRIBUTES}`;
}

// Logout: mesmo nome e atributos, Max-Age=0.
export function expiredSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Max-Age=0; ${ATTRIBUTES}`;
}

// Lê o valor do cookie da sessão de um cabeçalho Cookie.
export function readSessionCookie(cookieHeader: string | null): string | undefined {
  if (cookieHeader === null) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === SESSION_COOKIE_NAME) {
      const value = part.slice(separator + 1).trim();
      return value === "" ? undefined : value;
    }
  }
  return undefined;
}
