// Composição do gabarito (v4/CRITERIA.md, "Plano de testes > Composição dos casos", itens 1 a 7).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { casesFileSchema, type CasesFile } from "../../src/cases-schema.ts";
import { interpretationSchema } from "../../src/schema.ts";
import { TOOL_INPUT_SCHEMAS } from "../../src/tools.ts";
import { checkCatalogs } from "./catalog-check.ts";
import { CASE_IDS, ROOT_CASES_URL, composeCases, idProblems, loadCasesV4, readExpectedFile, readRootCases } from "./cases.ts";

type Case = CasesFile["cases"][number];
type Loose = Record<string, unknown>;

const rawRoot = JSON.parse(readFileSync(ROOT_CASES_URL, "utf8")) as { cases: Loose[] };
const composed = loadCasesV4();
const byId = (list: readonly Case[], id: string) => list.find((c) => c.id === id) as Case;

// Caminho com pontos existe num schema Zod (objetos aninhados, atravessando optional/nullable).
function hasPath(schema: unknown, path: string): boolean {
  let current = schema as { _zod: { def: Loose } } | undefined;
  for (const key of path.split(".")) {
    while (current !== undefined && ["optional", "nullable", "default"].includes(String(current._zod.def["type"]))) {
      current = current._zod.def["innerType"] as typeof current;
    }
    const shape = current?._zod.def["shape"] as Loose | undefined;
    if (shape === undefined || !Object.hasOwn(shape, key)) return false;
    current = shape[key] as typeof current;
  }
  return true;
}

// C6 da V3 com as mudanças documentadas no CRITERIA ("Diferenças em relação ao gabarito da V3").
function expectedC6FromV3(v3: Case["expected"]): Case["expected"] {
  if (v3.missingFields.mode !== "includes") throw new Error("C6 da V3 deveria usar includes");
  return {
    ...v3,
    entities: [...v3.entities, { path: "category", presence: "absent" }],
    missingFields: { mode: "includes", required: [...v3.missingFields.required, "CATEGORY"], forbidden: [...v3.missingFields.forbidden, "TYPE"] },
    expectedTool: "searchArticles",
    allowedExtraTools: [],
    toolArgs: { fields: [{ path: "query", presence: "required", rule: { match: "any" } }], forbidden: ["userId", "employeeId", "requesterId"] },
  };
}

describe("1. ids exatamente C1–C6", () => {
  it("expected.json e gabarito composto: sem falta, sem repetição, sem extra", () => {
    assert.deepEqual(idProblems(readExpectedFile().cases.map((c) => c.id)), []);
    assert.deepEqual(composed.cases.map((c) => c.id), [...CASE_IDS]);
  });

  it("negativos: id faltando, repetido ou extra recusa a composição", () => {
    const root = readRootCases();
    const overlay = readExpectedFile();
    const variants: [string, typeof overlay.cases][] = [
      ["faltando", overlay.cases.filter((c) => c.id !== "C3")],
      ["repetido", [...overlay.cases.filter((c) => c.id !== "C3"), { ...(overlay.cases[0] as (typeof overlay.cases)[number]) }]],
      ["extra", [...overlay.cases, { ...(overlay.cases[0] as (typeof overlay.cases)[number]), id: "C7" }]],
    ];
    for (const [name, cases] of variants) {
      assert.throws(() => composeCases(root, { ...overlay, cases }), /composição inválida/, name);
    }
    assert.deepEqual(idProblems(["C1", "C2", "C2", "C4", "C5", "C9"]), ["id repetido: C2", "id extra: C9", "id faltando: C3", "id faltando: C6"]);
  });
});

describe("2. entradas idênticas às da raiz", () => {
  it("scenario, history, state, input e inputSource iguais aos do ../cases.json (arquivo cru)", () => {
    for (const raw of rawRoot.cases) {
      const c = byId(composed.cases, String(raw["id"])) as unknown as Loose;
      for (const key of ["scenario", "history", "state", "input", "inputSource"]) {
        assert.deepEqual(c[key], raw[key], `${String(raw["id"])}.${key}`);
      }
    }
  });
});

describe("3–4. schema e catálogos", () => {
  it("casesFileSchema aceita o gabarito composto", () => {
    assert.doesNotThrow(() => casesFileSchema.parse(composed));
  });

  it("checkCatalogs sem problemas", () => {
    assert.deepEqual(checkCatalogs(composed), []);
  });
});

describe("5. caminhos das regras", () => {
  const entitiesSchema = interpretationSchema.shape.entities;

  it("hasPath reconhece caminhos válidos e recusa inválidos (controle)", () => {
    assert.equal(hasPath(entitiesSchema, "impact.workImpact"), true);
    assert.equal(hasPath(entitiesSchema, "impact.scope"), false);
    assert.equal(hasPath(entitiesSchema, "categoria"), false);
    assert.equal(hasPath(TOOL_INPUT_SCHEMAS.proposeTicketDraft, "impactAssessment.commitmentRisk"), true);
  });

  it("entities no interpretationSchema; toolArgs.fields no schema da tool esperada (inclusive absent)", () => {
    for (const c of composed.cases) {
      for (const rule of c.expected.entities) assert.ok(hasPath(entitiesSchema, rule.path), `${c.id}: entities.${rule.path}`);
      if (c.expected.expectedTool === "none") continue;
      const toolSchema = TOOL_INPUT_SCHEMAS[c.expected.expectedTool];
      for (const rule of c.expected.toolArgs?.fields ?? []) assert.ok(hasPath(toolSchema, rule.path), `${c.id}: ${c.expected.expectedTool}.${rule.path}`);
    }
  });
});

describe("6. missingFields", () => {
  it("required ∩ forbidden vazio", () => {
    for (const c of composed.cases) {
      const mf = c.expected.missingFields;
      if (mf.mode !== "includes") continue;
      assert.deepEqual(mf.required.filter((v) => mf.forbidden.includes(v)), [], c.id);
    }
  });
});

describe("7. diferenças em relação ao gabarito da V3", () => {
  const root = readRootCases();

  it("C1–C5: expected igual ao da raiz", () => {
    for (const id of ["C1", "C2", "C3", "C4", "C5"]) assert.deepEqual(byId(composed.cases, id).expected, byId(root.cases, id).expected, id);
  });

  it("C6: expected = o da V3 com só as mudanças listadas no CRITERIA", () => {
    assert.deepEqual(byId(composed.cases, "C6").expected, expectedC6FromV3(byId(root.cases, "C6").expected));
  });

  it("derivation: igual à da raiz, exceto no C2 (nota atualizada, mesmo tipo)", () => {
    for (const id of ["C1", "C3", "C4", "C5", "C6"]) assert.deepEqual(byId(composed.cases, id).derivation, byId(root.cases, id).derivation, id);
    const c2 = byId(composed.cases, "C2").derivation;
    assert.notDeepEqual(c2, byId(root.cases, "C2").derivation);
    assert.equal(c2.kind, byId(root.cases, "C2").derivation.kind);
  });

  it("metadados próprios da V4", () => {
    assert.equal(composed.version, "spike-adr009-v4");
    assert.notEqual(composed.version, root.version);
  });
});
