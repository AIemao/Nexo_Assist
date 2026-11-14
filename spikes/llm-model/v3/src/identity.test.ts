// Identidade com a V1 e a V2.1, importação sem efeito colateral e fecho de imports (v3/CRITERIA.md,
// "Reutilização", "Arquivos (manifesto previsto)"; plano de testes, "Pontuação e identidade").
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, posix, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { MAX_ATTEMPTS, MAX_STEPS, TURN_TIMEOUT_MS, verifyManifest } from "../../v2/src/run.ts";
import { TEST_HOOKS, cliRunOptions, readCriteria, testHooksUsed, verifyManifestV3 } from "./run.ts";
import { OLLAMA, OLLAMA_HOST, cases } from "./test-helpers.ts";

const SPIKE = new URL("../../", import.meta.url);
const SPIKE_DIR = fileURLToPath(SPIKE);
const V1_COMMIT = "2182d6b";
const sha256 = (path: string) => createHash("sha256").update(readFileSync(new URL(path, SPIKE))).digest("hex");
const MANIFEST_ROW = /^\| `([^`]+)` \| `([0-9a-f]{64})` \|$/;

// Fecho PREVISTO no CRITERIA da V3 ("Arquivos"): código importado da V1 e da V2.1.
const PREDICTED_IMPORTED = [
  "src/cases-schema.ts",
  "src/fixtures.ts",
  "src/models.ts",
  "src/prompt.ts",
  "src/run-record.ts",
  "src/run.ts",
  "src/schema.ts",
  "src/score.ts",
  "src/tools.ts",
  "v2/src/leak.ts",
  "v2/src/prompt.ts",
  "v2/src/protocol.ts",
  "v2/src/record.ts",
  "v2/src/run.ts",
  "v2/src/score.ts",
];
// Raízes do fecho: todos os arquivos de v3/src/ (a sondagem fica em v3/probe/, fora do manifesto).
const v3Files = () =>
  readdirSync(new URL("v3/src/", SPIKE))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `v3/src/${f}`)
    .sort();

// Fecho estático das importações relativas a partir dos arquivos da V3 (código e testes).
export function importClosure(roots: readonly string[]): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(resolve(SPIKE_DIR, file), "utf8");
    for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+"(\.{1,2}\/[^"]+)"|import\(\s*"(\.{1,2}\/[^"]+)"\s*\)/g)) {
      const spec = m[1] ?? m[2];
      if (spec === undefined) continue;
      visit(relative(SPIKE_DIR, resolve(dirname(resolve(SPIKE_DIR, file)), spec)).split("\\").join(posix.sep));
    }
  };
  roots.forEach(visit);
  return [...seen].sort();
}

describe("arquivos importados", () => {
  it("da V1: SHA-256 iguais aos do manifesto congelado da V1; run, run-record e score idênticos ao commit 2182d6b", () => {
    const rows = [...readFileSync(new URL("CRITERIA.md", SPIKE), "utf8").matchAll(/\| `([^`]+)` \| `([0-9a-f]{64})` \|/g)];
    assert.equal(rows.length, 11);
    for (const [, file = "", expected = ""] of rows) assert.equal(sha256(file), expected, file);
    for (const file of ["src/run.ts", "src/run-record.ts", "src/score.ts"]) {
      const committed = execFileSync("git", ["show", `${V1_COMMIT}:spikes/llm-model/${file}`], { cwd: SPIKE_DIR });
      assert.equal(createHash("sha256").update(committed).digest("hex"), sha256(file), file);
    }
  });

  it("da V2.1: os seis arquivos com o hash do manifesto da V2.1 (todos os 29 íntegros)", () => {
    const manifest = verifyManifest();
    assert.equal(manifest.length, 29);
    assert.deepEqual(manifest.filter((m) => !m.ok).map((m) => m.file), []);
    for (const file of PREDICTED_IMPORTED.filter((f) => f.startsWith("v2/"))) assert.ok(manifest.some((m) => m.file === file && m.ok), file);
  });
});

describe("configuração e prompt", () => {
  it("maxSteps, tempo limite e tentativas iguais aos do código da V1", () => {
    const v1 = readFileSync(new URL("src/run.ts", SPIKE), "utf8");
    const constant = (name: string) => Number(new RegExp(`const ${name} = ([0-9_]+);`).exec(v1)?.[1]?.replaceAll("_", ""));
    assert.equal(constant("MAX_STEPS"), MAX_STEPS);
    assert.equal(constant("TURN_TIMEOUT_MS"), TURN_TIMEOUT_MS);
    assert.equal(constant("MAX_ATTEMPTS"), MAX_ATTEMPTS);
  });

  it("as duas fases usam o SYSTEM_PROMPT da V1 (nenhum import do prompt da V2.1 no código da V3)", () => {
    const run = readFileSync(new URL("v3/src/run.ts", SPIKE), "utf8");
    assert.ok(run.includes('import { SYSTEM_PROMPT } from "../../src/prompt.ts";'));
    assert.equal(run.includes("v2/src/prompt.ts"), false);
    assert.equal((run.match(/instructions: SYSTEM_PROMPT/g) ?? []).length, 2, "os dois Agents");
  });
});

// Dados e dependências que entram no manifesto além do código (v3/CRITERIA.md, "Arquivos").
const MANIFEST_DATA = [".npmrc", "cases.json", "package-lock.json", "package.json"];

describe("manifesto da V3 (congelado em 2026-11-14)", () => {
  it("exatamente UMA tabela ativa no formato do verifyManifest, com 33 arquivos distintos, todos os SHA-256 iguais", () => {
    const runs: number[] = [];
    let current = 0;
    for (const line of readCriteria().split("\n")) {
      if (MANIFEST_ROW.test(line)) current += 1;
      else if (current > 0) {
        runs.push(current);
        current = 0;
      }
    }
    if (current > 0) runs.push(current);
    assert.deepEqual(runs, [33], "uma tabela ativa, de 33 linhas");
    const manifest = verifyManifestV3();
    assert.equal(manifest.length, 33);
    assert.equal(new Set(manifest.map((m) => m.file)).size, 33, "nenhum arquivo repetido");
    assert.deepEqual(manifest.filter((m) => !m.ok).map((m) => m.file), []);
  });

  it("fecho de imports = código da tabela gravada; o resto da tabela = dados e dependências", () => {
    const closure = importClosure(v3Files());
    console.log(`  [fecho] ${closure.length} arquivos: ${closure.join(", ")}`);
    assert.deepEqual(closure, [...PREDICTED_IMPORTED, ...v3Files()].sort(), "fecho igual ao previsto no CRITERIA");
    assert.equal(closure.some((f) => f.startsWith("v2/src/") && f.endsWith(".test.ts")), false, "nenhum teste da V2.1");
    assert.equal(closure.includes("v2/src/test-helpers.ts"), false);
    const table = verifyManifestV3().map((m) => m.file);
    assert.deepEqual(table.filter((f) => f.endsWith(".ts")).sort(), closure, "código da tabela gravada × fecho");
    assert.deepEqual(table.filter((f) => !f.endsWith(".ts")).sort(), MANIFEST_DATA, "dados e dependências");
  });

  it("os arquivos da V1 e da V2.1 na tabela da V3 têm o mesmo SHA-256 dos manifestos deles", () => {
    const rowsOf = (text: string) => new Map([...text.matchAll(/\| `([^`]+)` \| `([0-9a-f]{64})` \|/g)].map((m) => [m[1] as string, m[2] as string]));
    const v1 = rowsOf(readFileSync(new URL("CRITERIA.md", SPIKE), "utf8"));
    const v21 = rowsOf(readFileSync(new URL("v2/CRITERIA.md", SPIKE), "utf8"));
    const v3 = rowsOf(readCriteria());
    for (const [file, hash] of v3) {
      if (v1.has(file)) assert.equal(hash, v1.get(file), `${file} (V1)`);
      if (v21.has(file)) assert.equal(hash, v21.get(file), `${file} (V2.1)`);
    }
    assert.ok([...v3.keys()].filter((f) => v21.has(f)).length >= 19, "os 19 arquivos herdados aparecem também no manifesto da V2.1");
  });
});

describe("importação sem efeito colateral", () => {
  it("importar os módulos da V1, da V2.1 e da V3 num processo separado não imprime nem grava nada", () => {
    const count = (dir: string) => (existsSync(new URL(dir, SPIKE)) ? readdirSync(new URL(dir, SPIKE), { recursive: true }).length : -1);
    const dirs = ["results/", "v2/results/", "v3/results/"];
    const before = dirs.map(count);
    const modules = [...PREDICTED_IMPORTED, ...v3Files().filter((f) => !f.endsWith(".test.ts") && !f.endsWith("test-helpers.ts"))];
    const script = modules.map((m) => `await import(${JSON.stringify(new URL(m, SPIKE).href)});`).join("\n");
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: SPIKE_DIR, encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, "");
    assert.equal(child.stderr, "");
    assert.deepEqual(dirs.map(count), before, "nada gravado em results/");
  });
});

describe("ganchos de teste", () => {
  it("a CLI monta as opções sem nenhum gancho, e o cabeçalho registra nenhum (testHooksUsed vazio)", () => {
    const options = cliRunOptions(OLLAMA.config, OLLAMA.label, "ollama", [OLLAMA_HOST], cases, undefined);
    for (const hook of TEST_HOOKS) assert.equal(hook in options, false, hook);
    assert.deepEqual(testHooksUsed(options), []);
  });

  it("testHooksUsed acusa cada gancho presente", () => {
    assert.deepEqual(testHooksUsed({ fault: () => {}, timeoutMs: 1, monitor: async () => ({}), phase2Model: {}, invariantCheck: () => [] }), [...TEST_HOOKS]);
  });

  it("a função main só usa cliRunOptions e grava testHooksUsed(options) no cabeçalho; nenhum gancho aparece nela", () => {
    const run = readFileSync(new URL("v3/src/run.ts", SPIKE), "utf8");
    const main = run.slice(run.indexOf("async function main()"));
    assert.ok(main.includes("const options = cliRunOptions("));
    assert.ok(main.includes("round = await runModel(options);"));
    assert.ok(main.includes("testHooksUsed: testHooksUsed(options),"));
    assert.equal((main.match(/runModel\(/g) ?? []).length, 1, "uma única chamada à rodada");
    for (const hook of TEST_HOOKS) assert.equal(new RegExp(`\b${hook}\s*:`).test(main), false, hook);
  });
});
