// Referência da V4 (ADR-009, nota de 2026-11-22, W8.1; plano do web, F3). Sem git e sem rede:
// confere os bytes dos artefatos e dos textos copiados contra o manifesto. A comparação com o
// produto é da F7.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const webRoot = new URL("../", import.meta.url);
const baselineDir = new URL("./baseline/v4/", import.meta.url);

const sha256 = (path: string) => createHash("sha256").update(readFileSync(new URL(path, webRoot))).digest("hex");

type Loose = Record<string, unknown>;
const isLoose = (value: unknown): value is Loose => typeof value === "object" && value !== null && !Array.isArray(value);
const readJson = (name: string): unknown => JSON.parse(readFileSync(new URL(name, baselineDir), "utf8"));

function readManifest(): Loose {
  const value = readJson("manifest.json");
  if (!isLoose(value)) throw new Error("manifest.json não é um objeto");
  return value;
}
const manifest = readManifest();

function hashesIn(section: string): [string, string][] {
  const entries = manifest[section];
  if (!isLoose(entries)) throw new Error(`manifest.json sem ${section}`);
  return Object.entries(entries).map(([path, entry]) => {
    const hash = isLoose(entry) ? entry["sha256"] : undefined;
    if (typeof hash !== "string") throw new Error(`manifest.json: ${section}.${path} sem sha256`);
    return [path, hash];
  });
}

describe("referência da V4 (W8.1)", () => {
  it("o manifesto lista os três artefatos e os dois textos copiados", () => {
    expect(hashesIn("artifacts").map(([path]) => path).sort()).toStrictEqual([
      "test/baseline/v4/history-cases.json",
      "test/baseline/v4/projection.json",
      "test/baseline/v4/results-descriptor.json",
    ]);
    expect(hashesIn("copiedTexts").map(([path]) => path).sort()).toStrictEqual([
      "src/server/agent/baseline/v4/descriptions.ts",
      "src/server/agent/baseline/v4/prompt.ts",
    ]);
  });

  it.each([...hashesIn("artifacts"), ...hashesIn("copiedTexts")])("SHA-256 de %s igual ao do manifesto", (path, hash) => {
    expect(sha256(path)).toBe(hash);
  });

  it("o manifesto registra o commit da tag, o PROMPT_VERSION e as versões", () => {
    expect(manifest["tag"]).toStrictEqual({ name: "spike-adr-009", commit: "a6901c99376eefed9202e85678d4a97c56dc169d" });
    expect(manifest["promptVersion"]).toBe("spike-adr009-prompt-v4");
    expect(manifest["packages"]).toStrictEqual({ "@mastra/core": "1.81.0", "@mastra/schema-compat": "1.3.17", zod: "4.6.7" });
  });

  // DM v2.19 §3.12: o histórico representa a mensagem assistant com tool calls sem texto, seguida
  // dos resultados e do texto final numa mensagem própria.
  it.each(["H3", "H4"])("em %s, o texto do assistant fica numa mensagem própria depois dos resultados", (id) => {
    const history = readJson("history-cases.json");
    const cases = isLoose(history) && Array.isArray(history["cases"]) ? history["cases"] : [];
    const found: unknown = cases.find((c: unknown) => isLoose(c) && c["id"] === id);
    const output = isLoose(found) && Array.isArray(found["output"]) ? found["output"] : [];
    const roles = output.map((m: unknown) => (isLoose(m) ? m["role"] : undefined));
    expect(roles).toStrictEqual(["user", "assistant", "tool", "assistant", "user"]);
    const withCalls: unknown = output[1];
    const parts = isLoose(withCalls) && Array.isArray(withCalls["content"]) ? withCalls["content"] : [];
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every((p: unknown) => isLoose(p) && p["type"] === "tool-call")).toBe(true);
    const text: unknown = output[3];
    expect(isLoose(text) ? text["content"] : undefined).toBe("Texto final do turno anterior.");
  });
});
