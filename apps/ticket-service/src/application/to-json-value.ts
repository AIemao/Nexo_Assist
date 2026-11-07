import type { JsonValue } from "../domain/index.js";

// Converte um valor do domínio para JsonValue verificando cada nó em runtime.
// Chaves com undefined (opcionais ausentes) são descartadas, como no JSON.
export function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Número não representável em JSON: ${value}`);
    return value;
  }
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    const result: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) result[key] = toJsonValue(item);
    }
    return result;
  }
  throw new TypeError(`Valor não representável em JSON: ${typeof value}`);
}
