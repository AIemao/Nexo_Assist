// Manifesto da V4 e a CLI (v4/CRITERIA.md, "Ajustes da implementação (Etapa 2B)", item 4). A CLI lê
// como manifesto TODAS as linhas de v4/CRITERIA.md no formato | `arquivo` | `hash de 64 hex` |
// (verifyManifest da V2.1, v2/src/run.ts, chamado pelo verifyManifestV3 do v4/src/run.ts), sem olhar a
// seção. Este teste lê o CRITERIA real e confere que essas linhas só existem na seção "Arquivos
// (manifesto)" e que, com a seção sem linhas, a CLI se recusa a executar.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
    const frozen = rowsIn(CRITERIA, FREEZE_ROW);
    assert.equal(frozen.length, 9);
    for (const file of frozen) assert.equal(verifyManifestV3().some((m) => m.file === file), false, file);
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
