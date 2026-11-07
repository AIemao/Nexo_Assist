import type { JsonValue } from "../domain/index.js";
import { Prisma } from "../generated/prisma/client.js";

// Conversões entre o JsonValue do domínio (DM §3.16) e os tipos Json do Prisma.

// null no topo vira Prisma.JsonNull (JSON null), não NULL de banco.
export function toPrismaJson(value: JsonValue): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : value;
}

// O JsonObject do Prisma tem chaves opcionais (valor pode ser undefined);
// a cópia recursiva descarta essas chaves e devolve o tipo do domínio.
export function fromPrismaJson(value: Prisma.JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(fromPrismaJson);
  const result: { [key: string]: JsonValue } = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = fromPrismaJson(item);
  }
  return result;
}
