// Política de vazamento de raciocínio nos argumentos das tools (v2/CRITERIA.md, "Segurança").
// Helper da V2: o ../../src/run.ts da V1 continua idêntico ao commit 2182d6b.
//
// - submitInterpretation (a interpretação): regra completa da V1 (redactReasoningValue), sem mudança.
// - Tools de negócio:
//   - marcador de texto (<think>, canal analysis, <reasoning>) em todos os valores (redactReasoningText da V1);
//   - regra por nome de chave (/reason|think|thought/) mantida, EXCETO para os CAMINHOS declarados
//     no schema da tool (ex.: "reason" no topo do requestHandoff). Um "reason" aninhado onde o
//     schema não o declara continua sujeito à regra.
// - Tool desconhecida (sem schema): regra completa da V1, sem isenção.

import { z } from "zod";

import { redactReasoningText, redactReasoningValue } from "../../src/run.ts";
import { TOOL_INPUT_SCHEMAS } from "../../src/tools.ts";
import { SUBMIT_TOOL } from "./record.ts";

// Igual ao REASONING_KEY da V1 (não exportado por ela; o identity.test.ts confere no código da V1).
export const REASONING_KEY = /reason|think|thought/i;
const REMOVED = "[raciocínio removido]";

// Caminhos declarados no schema de entrada (JSON Schema do Zod), com "." entre os níveis.
function declaredPaths(schema: unknown): Set<string> {
  const paths = new Set<string>();
  const walk = (node: unknown, prefix: string) => {
    const properties = (node as { properties?: Record<string, unknown> } | null)?.properties ?? {};
    for (const [key, child] of Object.entries(properties)) {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      paths.add(path);
      walk(child, path);
    }
  };
  walk(z.toJSONSchema(schema as z.ZodType), "");
  return paths;
}

const DECLARED: Record<string, Set<string>> = Object.fromEntries(Object.entries(TOOL_INPUT_SCHEMAS).map(([name, schema]) => [name, declaredPaths(schema)]));

export function declaredPathsOf(toolName: string): ReadonlySet<string> | null {
  return DECLARED[toolName] ?? null;
}

// Marcador em todos os valores; regra por chave exceto nos caminhos declarados.
function redactWithExemptions(value: unknown, declared: ReadonlySet<string>, prefix: string): { value: unknown; leaked: boolean } {
  if (typeof value === "string") {
    const r = redactReasoningText(value);
    return { value: r.text, leaked: r.leaked };
  }
  if (Array.isArray(value)) {
    let leaked = false;
    const items = value.map((item) => {
      const r = redactWithExemptions(item, declared, prefix);
      leaked ||= r.leaked;
      return r.value;
    });
    return { value: items, leaked };
  }
  if (typeof value === "object" && value !== null) {
    let leaked = false;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      if (REASONING_KEY.test(key) && !declared.has(path)) {
        out[key] = REMOVED;
        leaked = true;
        continue;
      }
      const r = redactWithExemptions(item, declared, path);
      leaked ||= r.leaked;
      out[key] = r.value;
    }
    return { value: out, leaked };
  }
  return { value, leaked: false };
}

// Remoção de raciocínio dos argumentos de uma chamada, pela política acima.
export function redactToolArgs(toolName: string, value: unknown): { value: unknown; leaked: boolean } {
  if (toolName === SUBMIT_TOOL) return redactReasoningValue(value);
  const declared = declaredPathsOf(toolName);
  if (declared === null) return redactReasoningValue(value);
  return redactWithExemptions(value, declared, "");
}
