// Checagem de catálogos (v4/CRITERIA.md, "Plano de testes > Checagem de catálogos"; exceção
// controlada 2): aceita o ../cases.json da raiz, recusa variações quebradas e é cópia fiel do trecho
// do ../../src/check-cases.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { CasesFile } from "../../src/cases-schema.ts";
import { checkCatalogs } from "./catalog-check.ts";
import { readRootCases } from "./cases.ts";

type Case = CasesFile["cases"][number];

const root = readRootCases();
const caseIn = (file: CasesFile, id: string) => file.cases.find((c) => c.id === id) as Case;

function variant(mutate: (file: CasesFile) => void): CasesFile {
  const file = structuredClone(root);
  mutate(file);
  return file;
}

describe("aceita", () => {
  it("o ../cases.json da raiz: zero problemas", () => {
    assert.deepEqual(checkCatalogs(root), []);
  });
});

describe("recusa variações quebradas (uma por problema)", () => {
  const cases: [string, (file: CasesFile) => void, RegExp][] = [
    ["intent fora do catálogo", (f) => void (caseIn(f, "C1").expected.intent = "FOO"), /C1 \(SC-01\): intent fora do catálogo/],
    ["missingField fora do catálogo", (f) => void (caseIn(f, "C1").expected.missingFields = { mode: "exact", values: ["FOO"] }), /missingField "FOO" fora do catálogo/],
    [
      "valor equals fora do catálogo do caminho",
      (f) => void (caseIn(f, "C4").expected.entities = [{ path: "category", presence: "optional", rule: { match: "equals", values: ["hardware"] } }]),
      /"hardware" fora do catálogo de category/,
    ],
    [
      "valor normalized-contains-any não normalizado",
      (f) => {
        const args = caseIn(f, "C1").expected.toolArgs;
        if (args === null) throw new Error("C1 sem toolArgs");
        args.fields = [{ path: "query", presence: "required", rule: { match: "normalized-contains-any", values: ["Horário"] } }];
      },
      /valor "Horário" de query não está normalizado/,
    ],
    [
      "argumentos inválidos numa chamada do histórico",
      (f) => {
        const turn = caseIn(f, "C5").history.at(-1);
        if (turn === undefined || turn.role !== "assistant" || turn.toolCalls === undefined) throw new Error("C5 sem proposta no histórico");
        (turn.toolCalls[0] as { args: Record<string, unknown> }).args["type"] = "XYZ";
      },
      /histórico, turno 8: argumentos inválidos para proposeTicketDraft/,
    ],
    [
      "estado com PendingAction sem a proposta correspondente",
      (f) => void (caseIn(f, "C1").state.pendingAction = { type: "CREATE_TICKET", id: "PA-X", version: 1, status: "PENDING_CONFIRMATION" }),
      /o estado declara a PendingAction PA-X, que não é o resultado da última proposta gravada/,
    ],
    ["proposta no histórico sem PendingAction no estado", (f) => void (caseIn(f, "C5").state.pendingAction = null), /o histórico tem proposta, mas o estado não tem PendingAction/],
    ["cenário repetido", (f) => void (caseIn(f, "C2").scenario = "SC-01"), /C2 \(SC-01\): cenário repetido/],
  ];
  for (const [name, mutate, expected] of cases) {
    it(name, () => {
      const problems = checkCatalogs(variant(mutate));
      assert.equal(problems.length, 1, problems.join("\n"));
      assert.match(problems[0] as string, expected);
    });
  }
});

describe("cópia fiel do ../../src/check-cases.ts", () => {
  const original = readFileSync(new URL("../../src/check-cases.ts", import.meta.url), "utf8").split("\n");
  const copy = readFileSync(new URL("./catalog-check.ts", import.meta.url), "utf8").split("\n");
  const block = (lines: string[], start: string, end: (line: string) => boolean): string[] => {
    const from = lines.findIndex((l) => l.trim() === start);
    assert.ok(from >= 0, `início não encontrado: ${start}`);
    const to = lines.findIndex((l, i) => i > from && end(l));
    assert.ok(to > from, `fim não encontrado depois de ${start}`);
    return lines.slice(from, to).map((l) => l.trimStart());
  };

  it("mapa CATALOG_BY_PATH idêntico", () => {
    const start = "// Campos cujos valores são de catálogo: uma regra \"equals\" só pode citar valores do catálogo.";
    const endOfMap = (l: string) => l === "};";
    assert.deepEqual(block(copy, start, endOfMap), block(original, start, endOfMap));
  });

  it("laço de verificação por caso idêntico, linha a linha, descontada a indentação", () => {
    const start = "const scenarios = new Set<string>();";
    const fromOriginal = block(original, start, (l) => l.startsWith("if (problems.length > 0)"));
    const fromCopy = block(copy, start, (l) => l.trim() === "// --- fim do trecho copiado ---");
    // O original tem uma linha em branco entre o laço e o "if (problems.length > 0)".
    assert.equal(fromOriginal.at(-1), "");
    assert.deepEqual(fromCopy, fromOriginal.slice(0, -1));
  });
});
