// Gabarito composto da V4 (v4/CRITERIA.md, "Gabarito da V4"; "Estrutura > Etapa 1").
//
// scenario, history, state, input e inputSource vêm do ../../cases.json (V1, sem cópia); expected,
// justification e, quando houver, derivation vêm do ../expected.json. O resultado é validado pelo
// casesFileSchema da V1 (sem mudança) e pela checagem de catálogos (catalog-check.ts).
import { readFileSync } from "node:fs";

import { z } from "zod";

import { casesFileSchema, type CasesFile } from "../../src/cases-schema.ts";
import { checkCatalogs } from "./catalog-check.ts";

type Case = CasesFile["cases"][number];

export const ROOT_CASES_URL = new URL("../../cases.json", import.meta.url);
export const EXPECTED_URL = new URL("../expected.json", import.meta.url);
export const CASE_IDS = ["C1", "C2", "C3", "C4", "C5", "C6"] as const;

// Formato do ../expected.json. Os campos de cada caso são validados pelo casesFileSchema depois da
// composição; aqui só a forma do arquivo e a lista de chaves permitidas.
export const expectedFileSchema = z.strictObject({
  version: z.string().min(1),
  frozenAt: z.string().min(1),
  notes: z.array(z.string().min(1)),
  cases: z.array(
    z.strictObject({
      id: z.string().min(1),
      derivation: z.unknown().optional(),
      expected: z.unknown(),
      justification: z.unknown(),
    }),
  ),
});
export type ExpectedFile = z.infer<typeof expectedFileSchema>;

const readJson = (url: URL): unknown => JSON.parse(readFileSync(url, "utf8"));

export const readRootCases = (): CasesFile => casesFileSchema.parse(readJson(ROOT_CASES_URL));
export const readExpectedFile = (): ExpectedFile => expectedFileSchema.parse(readJson(EXPECTED_URL));

// Ids exatamente C1–C6: sem falta, sem repetição, sem extra. Devolve os problemas (vazio = ok).
export function idProblems(ids: readonly string[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) problems.push(`id repetido: ${id}`);
    seen.add(id);
    if (!(CASE_IDS as readonly string[]).includes(id)) problems.push(`id extra: ${id}`);
  }
  for (const id of CASE_IDS) if (!seen.has(id)) problems.push(`id faltando: ${id}`);
  return problems;
}

// Composição pura: não lê arquivo. Lança erro se os ids não forem exatamente C1–C6 (nos dois lados),
// se o resultado não passar no casesFileSchema ou se a checagem de catálogos achar problema.
export function composeCases(root: CasesFile, overlay: ExpectedFile): CasesFile {
  const problems = [
    ...idProblems(root.cases.map((c) => c.id)).map((p) => `../cases.json: ${p}`),
    ...idProblems(overlay.cases.map((c) => c.id)).map((p) => `expected.json: ${p}`),
  ];
  if (problems.length > 0) throw new Error(`composição inválida:\n- ${problems.join("\n- ")}`);

  const cases = root.cases.map((base): Case => {
    const extra = overlay.cases.find((c) => c.id === base.id) as ExpectedFile["cases"][number];
    return {
      id: base.id,
      scenario: base.scenario,
      derivation: (extra.derivation ?? base.derivation) as Case["derivation"],
      history: base.history,
      state: base.state,
      input: base.input,
      inputSource: base.inputSource,
      expected: extra.expected as Case["expected"],
      justification: extra.justification as Case["justification"],
    };
  });
  const composed = casesFileSchema.parse({ version: overlay.version, frozenAt: overlay.frozenAt, notes: overlay.notes, cases });
  const catalog = checkCatalogs(composed);
  if (catalog.length > 0) throw new Error(`gabarito composto inválido:\n- ${catalog.join("\n- ")}`);
  return composed;
}

// O gabarito da V4, lido dos dois arquivos.
export const loadCasesV4 = (): CasesFile => composeCases(readRootCases(), readExpectedFile());
