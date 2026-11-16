// Linha de base (v4/CRITERIA.md, "Linha de base (repontuação da V3)"). A equivalência registro a
// registro já está provada em v4/src/equivalence.test.ts (congelado); aqui só se confere que o
// caminho do script, rodado com o gabarito da raiz e a regra do C6 da V3, reproduz os números oficiais.
//   node --test v4/baseline/rescore.test.ts            (na pasta spikes/llm-model/)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readRootCases } from "../src/cases.ts";
import { c6V3 } from "../src/score.ts";
import { OFFICIAL_RUNS, officialSummaryMatches, readOfficialRun, rescore, verifyFrozenV4 } from "./rescore.ts";

const root = readRootCases().cases;

describe("script da linha de base com o gabarito da raiz e o C6 da V3", () => {
  for (const stem of OFFICIAL_RUNS) {
    it(`${stem}: reproduz os números oficiais da V3, sem turno alterado`, () => {
      const r = rescore(readOfficialRun(stem), root, root, c6V3);
      assert.equal(officialSummaryMatches(r), true, "a coluna V3 oficial é a publicada");
      assert.deepEqual(r.v4.aggregate, r.v3.aggregate);
      assert.deepEqual(r.changes, []);
    });
  }
});

describe("verificação dos arquivos congelados", () => {
  it("os 9 arquivos da tabela de congelamento conferem", () => {
    const frozen = verifyFrozenV4();
    assert.equal(frozen.length, 9);
    assert.deepEqual(frozen.filter((f) => !f.ok).map((f) => f.file), []);
  });

  it("hash divergente ou ausente na tabela é detectado", () => {
    const tampered = verifyFrozenV4("| `v4/expected.json` | `" + "0".repeat(64) + "` |");
    assert.equal(tampered.find((f) => f.file === "v4/expected.json")?.ok, false);
    assert.equal(tampered.find((f) => f.file === "v4/src/score.ts")?.expected, null);
  });
});
