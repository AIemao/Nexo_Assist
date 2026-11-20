// Manifesto da V4 e a CLI (v4/CRITERIA.md, "Ajustes da implementação (Etapa 2B)", item 4). A CLI lê
// como manifesto TODAS as linhas de v4/CRITERIA.md no formato | `arquivo` | `hash de 64 hex` |
// (verifyManifest da V2.1, v2/src/run.ts, chamado pelo verifyManifestV3 do v4/src/run.ts), sem olhar a
// seção. Este teste lê o CRITERIA real e confere que essas linhas só existem na seção "Arquivos
// (manifesto)" e que, com a seção sem linhas, a CLI se recusa a executar.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { spikeModels } from "../../src/models.ts";
import { verifyManifestV3 } from "./run.ts";

const SPIKE = new URL("../../", import.meta.url);
const CRITERIA = readFileSync(new URL("v4/CRITERIA.md", SPIKE), "utf8");
// O mesmo formato do verifyManifest da V2.1 (v2/src/run.ts, linha 425).
const MANIFEST_ROW = /\| `([^`]+)` \| `([0-9a-f]{64})` \|/g;
// Formato da tabela de congelamento (hash sem crases).
const FREEZE_ROW = /\| `(v4\/[^`]+)` \| ([0-9a-f]{64}) \|/g;

const manifestSection = (() => {
  const start = CRITERIA.indexOf("## Arquivos (manifesto)");
  assert.ok(start >= 0, 'seção "Arquivos (manifesto)" ausente');
  const next = CRITERIA.indexOf("\n## ", start + 1);
  return CRITERIA.slice(start, next < 0 ? undefined : next);
})();
const rowsIn = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => m[1] as string);

describe("manifesto da V4 no CRITERIA real", () => {
  it("toda linha lida pela CLI como manifesto está na seção \"Arquivos (manifesto)\"", () => {
    const read = verifyManifestV3().map((m) => m.file);
    assert.deepEqual(read, rowsIn(CRITERIA, MANIFEST_ROW), "a CLI lê exatamente as linhas nesse formato");
    assert.deepEqual(read, rowsIn(manifestSection, MANIFEST_ROW), "nenhuma fora da seção");
  });

  it("a tabela de congelamento (9 arquivos) está fora do formato do manifesto", () => {
    // O trecho da tabela de congelamento: do primeiro ao último arquivo dela.
    const frozen = rowsIn(CRITERIA, FREEZE_ROW);
    assert.equal(frozen.length, 9);
    const first = CRITERIA.indexOf(`| \`${frozen[0]}\` |`);
    const last = CRITERIA.indexOf("\n", CRITERIA.indexOf(`| \`${frozen.at(-1)}\` |`, first));
    const freezeTable = CRITERIA.slice(first, last);
    assert.equal(rowsIn(freezeTable, FREEZE_ROW).length, 9, "o trecho tem as 9 linhas");
    assert.deepEqual(rowsIn(freezeTable, MANIFEST_ROW), [], "nenhuma linha no formato lido pela CLI");
    assert.equal(manifestSection.includes(freezeTable), false, "a tabela de congelamento não está na seção do manifesto");
  });

  it("com a seção \"Arquivos (manifesto)\" sem linhas, a CLI se recusa a executar", (t) => {
    if (rowsIn(manifestSection, MANIFEST_ROW).length > 0) {
      t.skip("seção já preenchida: o caso de recusa não se aplica");
      return;
    }
    assert.equal(verifyManifestV3().length, 0);
    const label = spikeModels().find((m) => m.label.startsWith("ollama "))?.label;
    assert.ok(label !== undefined);
    // Processo filho, sem --env-file e sem rede: a CLI para na verificação do manifesto.
    const run = spawnSync(process.execPath, ["v4/src/run.ts", "--model", label], { cwd: fileURLToPath(SPIKE), encoding: "utf8", timeout: 60_000 });
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /Manifesto da V4 ainda não congelado/);
    assert.equal(run.stdout.includes("Resultados em"), false);
  });
});

// ---------------------------------------------------------------------------
// Fecho do manifesto (v4/CRITERIA.md, "Arquivos (manifesto)"): mesmo critério da V3. Entra todo
// arquivo carregado na execução ou nos testes da V4: o fecho estático das importações relativas a
// partir de todos os arquivos de v4/src/ e v4/baseline/ (código e testes), mais os dados lidos sem
// import e as dependências. O v4/CRITERIA.md não entra (contém o manifesto).

const SPIKE_DIR = fileURLToPath(SPIKE);
const v4Roots = () =>
  ["v4/src/", "v4/baseline/"].flatMap((dir) =>
    readdirSync(new URL(dir, SPIKE))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => `${dir}${f}`),
  );

// Mesma regra do importClosure da V3 (v3/src/identity.test.ts).
function importClosure(roots: readonly string[]): string[] {
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

// Lidos sem import (dados e textos comparados pelos testes) e dependências.
const MANIFEST_EXTRAS = [
  "cases.json", // gabarito da raiz: entradas e históricos (composição)
  "v4/expected.json", // gabarito da V4
  "src/check-cases.ts", // lido como texto pelo catalog-check.test.ts (cópia fiel)
  "v3/CRITERIA.md", // manifesto da V3, lido pela linha de base
  "v3/results/ollama-qwen3-4b-instruct/2026-11-14T14-12-46-951Z.jsonl", // registros oficiais da V3
  "v3/results/ollama-qwen3-4b-instruct/2026-11-14T14-12-46-951Z-summary.md",
  "v3/results/ollama-qwen3-8b/2026-11-14T14-15-14-181Z.jsonl",
  "v3/results/ollama-qwen3-8b/2026-11-14T14-15-14-181Z-summary.md",
  "tsconfig.json",
  "v4/tsconfig.json",
  "v4/baseline/tsconfig.json",
  "package.json",
  "package-lock.json",
  ".npmrc",
] as const;

describe("fecho do manifesto da V4", () => {
  const manifest = rowsIn(manifestSection, MANIFEST_ROW);

  it("o manifesto é exatamente o fecho de imports da V4 mais os arquivos lidos sem import e as dependências", (t) => {
    if (manifest.length === 0) {
      t.skip("seção ainda sem linhas");
      return;
    }
    const closure = importClosure(v4Roots());
    console.log(`  [fecho] ${closure.length} arquivos de código; manifesto ${manifest.length} linhas`);
    assert.deepEqual([...manifest].sort(), [...new Set([...closure, ...MANIFEST_EXTRAS])].sort());
    assert.equal(manifest.includes("v4/CRITERIA.md"), false, "o CRITERIA não entra");
  });

  it("todo arquivo do manifesto existe e confere (verifyManifestV3, todas as linhas OK)", (t) => {
    if (manifest.length === 0) {
      t.skip("seção ainda sem linhas");
      return;
    }
    for (const file of manifest) assert.ok(existsSync(new URL(file, SPIKE)), `existe: ${file}`);
    const checked = verifyManifestV3();
    assert.equal(checked.length, manifest.length);
    assert.deepEqual(checked.filter((m) => !m.ok).map((m) => m.file), []);
  });
});
