import { createHash, randomBytes } from "node:crypto";

// ADR-012: token opaco de 256 bits, gerado com crypto.randomBytes. Vai no cookie em base64url
// (43 caracteres); o banco guarda só o hash SHA-256, em hex.
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// Valor de cookie fora do formato não é token: nem chega ao banco.
export function isWellFormedToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}
