// Equivalência (v4/CRITERIA.md, "Plano de testes > Equivalência"): com o gabarito da raiz (o da V3,
// no mesmo schema) e a regra do C6 da V3, a pontuação da V4 reproduz exatamente a pontuação oficial
// da V3 nos dois registros oficiais. Só lê os registros; nada é gravado.
//   node --test v4/src/*.test.ts            (na pasta spikes/llm-model/)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { casesFileSchema } from "../../src/cases-schema.ts";
import type { RunHeaderV3, TurnRecordV3 } from "../../v3/src/record.ts";
import { summaryMarkdown } from "../../v3/src/run.ts";
import { aggregateV3, scoreTurnV3, toV1View } from "../../v3/src/score.ts";
import { aggregateV4, c6OtherConditions, c6V3, scoreTurnV4 } from "./score.ts";

const SPIKE = new URL("../../", import.meta.url);
const OFFICIAL = [
  "v3/results/ollama-qwen3-4b-instruct/2026-11-14T14-12-46-951Z",
  "v3/results/ollama-qwen3-8b/2026-11-14T14-15-14-181Z",
] as const;

const rootCases = casesFileSchema.parse(JSON.parse(readFileSync(new URL("cases.json", SPIKE), "utf8"))).cases;
const caseOf = (id: string) => {
  const c = rootCases.find((x) => x.id === id);
  if (c === undefined) throw new Error(`caso desconhecido: ${id}`);
  return c;
};

function readRun(stem: string): { header: RunHeaderV3; records: TurnRecordV3[]; summary: string } {
  const lines = readFileSync(new URL(`${stem}.jsonl`, SPIKE), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { type: string });
  const header = lines.find((l) => l.type === "run") as unknown as RunHeaderV3;
  const records = lines.filter((l) => l.type === "turn") as unknown as TurnRecordV3[];
  const summary = readFileSync(new URL(`${stem}-summary.md`, SPIKE), "utf8");
  return { header, records, summary };
}

describe("equivalência com a pontuação oficial da V3 (gabarito da raiz, C6 da V3)", () => {
  for (const stem of OFFICIAL) {
    describe(stem, () => {
      const { header, records, summary } = readRun(stem);

      it("18 turnos", () => {
        assert.equal(records.length, 18);
      });

      it("por turno: scoreTurnV4 igual ao scoreTurnV3 (Zod, intenção, tool, entidades, C6, códigos, chave de estabilidade)", () => {
        for (const record of records) {
          const v3 = scoreTurnV3(record, caseOf(record.caseId));
          const v4 = scoreTurnV4(record, caseOf(record.caseId), c6V3);
          const where = `${record.caseId}, repetição ${record.repetition}`;
          assert.deepEqual(v4.v1, v3.v1, where);
          assert.deepEqual(v4.codes, v3.codes, where);
          assert.equal(v4.phase2Parse, v3.phase2Parse, where);
          assert.equal(v4.mastraObjectPresent, v3.mastraObjectPresent, where);
          assert.equal(v4.phase2ToolCalls, v3.phase2ToolCalls, where);
        }
      });

      it("aggregateV4 igual ao aggregateV3", () => {
        const v3 = aggregateV3(rootCases, records.map((r) => scoreTurnV3(r, caseOf(r.caseId))));
        const v4 = aggregateV4(rootCases, records.map((r) => scoreTurnV4(r, caseOf(r.caseId), c6V3)));
        assert.deepEqual(v4, v3);
      });

      it("decomposição do C6: condições 1 a 4 e 6 da V4 + zero tools de negócio = C6 oficial da V3", () => {
        for (const record of records.filter((r) => r.caseId === "C6")) {
          const v3 = scoreTurnV3(record, caseOf("C6")).v1.c6Expected;
          const noBusinessTools = toV1View(record).businessToolCalls.length === 0;
          assert.equal(c6OtherConditions(record, caseOf("C6")) && noBusinessTools, v3, `repetição ${record.repetition}`);
        }
      });

      it("o resumo regenerado com as pontuações da V4 é idêntico ao *-summary.md oficial", () => {
        const scores = records.map((r) => scoreTurnV4(r, caseOf(r.caseId), c6V3));
        const regenerated = summaryMarkdown(header, records, scores, aggregateV4(rootCases, scores));
        assert.equal(regenerated, summary);
      });
    });
  }
});
