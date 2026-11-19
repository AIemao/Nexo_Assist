// Exceção controlada 1 (v4/CRITERIA.md, "Estrutura > Etapa 2"): v4/src/run.ts é cópia do
// v3/src/run.ts e só difere nas linhas autorizadas (imports de prompt, tools, schemas, pontuação e
// composição dos casos; caminhos; ids dos Agents; cabeçalho do registro e do arquivo). Diferença linha a
// linha pela maior subsequência comum: toda linha removida da V3 e toda linha acrescentada na V4 têm de
// estar na lista abaixo, e toda linha da lista tem de aparecer na diferença.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

type Category = "imports" | "caminhos" | "ids dos Agents" | "cabeçalho" | "pontuação" | "composição dos casos";
interface Change {
  category: Category;
  v3: string[];
  v4: string[];
}

const AUTHORIZED: Change[] = [
  {
    category: "cabeçalho",
    v3: [
      "// Execução da V3 do spike do ADR-009 (v3/CRITERIA.md). Uso, depois do congelamento:",
      '//   node --env-file=.env v3/src/run.ts --model "<rótulo>"',
      "// Enquanto o manifesto da V3 não existir, a CLI se recusa a executar.",
      "// Prompt da V1 nas duas fases. 180 s por tentativa, compartilhados pelas duas fases. Captura da V3",
    ],
    v4: [
      "// Execução da V4 do spike do ADR-009 (v4/CRITERIA.md). Uso, depois do congelamento:",
      '//   node --env-file=.env v4/src/run.ts --model "<rótulo>"',
      "// Cópia controlada do v3/src/run.ts (exceção 1): só imports, caminhos, ids dos Agents e cabeçalho mudam.",
      "// Instruções da V4 nas duas fases. 180 s por tentativa, compartilhados pelas duas fases. Captura da V3",
    ],
  },
  {
    category: "imports",
    v3: [
      'import { casesFileSchema, type CasesFile } from "../../src/cases-schema.ts";',
      'import { SYSTEM_PROMPT } from "../../src/prompt.ts";',
      'import { TOOL_INPUT_SCHEMAS, createFakeTools } from "../../src/tools.ts";',
      'import { CaptureLayer, normalizeUrl, readInterpretation } from "./phase2.ts";',
      'import type { AttemptV3, FidelityReport, InstrumentFailure, InvariantViolationV3, Phase1Record, Phase2Record, RunHeaderV3, TurnRecordV3 } from "./record.ts";',
      'import { aggregateV3, checkInvariantsV3, combineContextChecks, invariantReportV3, scoreTurnV3, type TurnScoreV3 } from "./score.ts";',
      'import { fidelityA, fidelityB, filterTranscript, transcriptCounts } from "./transcript.ts";',
    ],
    v4: [
      'import type { CasesFile } from "../../src/cases-schema.ts";',
      'import { PROMPT_VERSION, SYSTEM_PROMPT } from "./prompt.ts";',
      'import { TOOL_INPUT_SCHEMAS_V4 as TOOL_INPUT_SCHEMAS, createFakeToolsV4 as createFakeTools } from "./tools.ts";',
      'import { CaptureLayer, normalizeUrl, readInterpretation } from "../../v3/src/phase2.ts";',
      'import type { AttemptV3, FidelityReport, InstrumentFailure, InvariantViolationV3, Phase1Record, Phase2Record, RunHeaderV3, TurnRecordV3 } from "../../v3/src/record.ts";',
      'import { checkInvariantsV3, combineContextChecks, invariantReportV3, type TurnScoreV3 } from "../../v3/src/score.ts";',
      'import { loadCasesV4 } from "./cases.ts";',
      'import { aggregateV4, scoreTurnV4, type TurnScoreV4 } from "./score.ts";',
      'import { fidelityA, fidelityB, filterTranscript, transcriptCounts } from "../../v3/src/transcript.ts";',
    ],
  },
  {
    category: "cabeçalho",
    v3: [],
    v4: ['type RunHeaderV4 = Omit<RunHeaderV3, "experiment"> & { experiment: "v4"; promptVersion: string };'],
  },
  {
    category: "caminhos",
    v3: [
      'const V3_ROOT = new URL("../", import.meta.url);',
      'export const readCriteria = () => readFileSync(new URL("CRITERIA.md", V3_ROOT), "utf8");',
      '    console.error(`Uso: node --env-file=.env v3/src/run.ts --model "<rótulo>"\\nRótulos (Groq fora da V3): ${models.map((m) => `"${m.label}"`).join(", ")}`);',
      '    console.error(manifest.length === 0 ? "Manifesto da V3 ainda não congelado (v3/CRITERIA.md, \\"Arquivos\\"). Execução recusada." : `Manifesto divergente: ${manifest.filter((m) => !m.ok).map((m) => m.file).join(", ")}. Execução abortada.`);',
      "  const files = writeRound(new URL(`results/${slug}/`, V3_ROOT), stamp, header, round.records, scores, agg);",
    ],
    v4: [
      'const V4_ROOT = new URL("../", import.meta.url);',
      'export const readCriteria = () => readFileSync(new URL("CRITERIA.md", V4_ROOT), "utf8");',
      '    console.error(`Uso: node --env-file=.env v4/src/run.ts --model "<rótulo>"\\nRótulos (Groq fora da V4): ${models.map((m) => `"${m.label}"`).join(", ")}`);',
      '    console.error(manifest.length === 0 ? "Manifesto da V4 ainda não congelado (v4/CRITERIA.md, \\"Arquivos\\"). Execução recusada." : `Manifesto divergente: ${manifest.filter((m) => !m.ok).map((m) => m.file).join(", ")}. Execução abortada.`);',
      "  const files = writeRound(new URL(`results/${slug}/`, V4_ROOT), stamp, header, round.records, scores, agg);",
    ],
  },
  {
    category: "ids dos Agents",
    v3: [
      '  const phase1Agent = new Agent({ id: "spike-adr009-v3-fase1", name: "spike-adr009-v3-fase1", instructions: SYSTEM_PROMPT, model: input.model, tools });',
      '  const phase2Agent = new Agent({ id: "spike-adr009-v3-fase2", name: "spike-adr009-v3-fase2", instructions: SYSTEM_PROMPT, model: input.phase2Model ?? input.model });',
    ],
    v4: [
      '  const phase1Agent = new Agent({ id: "spike-adr009-v4-fase1", name: "spike-adr009-v4-fase1", instructions: SYSTEM_PROMPT, model: input.model, tools });',
      '  const phase2Agent = new Agent({ id: "spike-adr009-v4-fase2", name: "spike-adr009-v4-fase2", instructions: SYSTEM_PROMPT, model: input.phase2Model ?? input.model });',
    ],
  },
  {
    category: "composição dos casos",
    v3: ['  const cases = casesFileSchema.parse(JSON.parse(readFileSync(new URL("cases.json", SPIKE_ROOT), "utf8"))).cases;'],
    v4: ["  const cases = loadCasesV4().cases;"],
  },
  {
    category: "pontuação",
    v3: [
      "  let scores: TurnScoreV3[] = [];",
      "  if (round.aborted === null) scores = round.records.map((r) => scoreTurnV3(r, cases.find((c) => c.id === r.caseId) as Case));",
      "  const agg = round.aborted === null ? aggregateV3(cases, scores) : null;",
    ],
    v4: [
      "  let scores: TurnScoreV4[] = [];",
      "  if (round.aborted === null) scores = round.records.map((r) => scoreTurnV4(r, cases.find((c) => c.id === r.caseId) as Case));",
      "  const agg = round.aborted === null ? aggregateV4(cases, scores) : null;",
    ],
  },
  {
    category: "cabeçalho",
    v3: [
      "export function summaryMarkdown(header: RunHeaderV3, records: TurnRecordV3[], scores: TurnScoreV3[], agg: Aggregate | null): string {",
      "    `# Spike ADR-009, V3: ${header.model}`,",
      "export function runJsonl(header: RunHeaderV3, records: readonly TurnRecordV3[]): string {",
      "export function writeRound(dir: URL, stamp: string, header: RunHeaderV3, records: TurnRecordV3[], scores: TurnScoreV3[], agg: Aggregate | null): { jsonl: URL; summary: URL } {",
      "  const header: RunHeaderV3 = {",
      '    experiment: "v3",',
    ],
    v4: [
      "export function summaryMarkdown(header: RunHeaderV4, records: TurnRecordV3[], scores: TurnScoreV3[], agg: Aggregate | null): string {",
      "    `# Spike ADR-009, V4: ${header.model}`,",
      "export function runJsonl(header: RunHeaderV4, records: readonly TurnRecordV3[]): string {",
      "export function writeRound(dir: URL, stamp: string, header: RunHeaderV4, records: TurnRecordV3[], scores: TurnScoreV3[], agg: Aggregate | null): { jsonl: URL; summary: URL } {",
      "  const header: RunHeaderV4 = {",
      '    experiment: "v4",',
      "    promptVersion: PROMPT_VERSION,",
    ],
  },
];

// Diferença pela maior subsequência comum (LCS): linhas só da V3 (removidas) e só da V4 (acrescentadas).
function lineDiff(a: string[], b: string[]): { removed: string[]; added: string[] } {
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) removed.push(a[i++]!);
    else added.push(b[j++]!);
  }
  while (i < n) removed.push(a[i++]!);
  while (j < m) added.push(b[j++]!);
  return { removed, added };
}

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").split("\n");

describe("v4/src/run.ts, cópia controlada do v3/src/run.ts", () => {
  const { removed, added } = lineDiff(read("../../v3/src/run.ts"), read("./run.ts"));

  it("toda linha removida da V3 está na lista autorizada, e toda linha autorizada da V3 foi removida", () => {
    assert.deepEqual([...removed].sort(), AUTHORIZED.flatMap((c) => c.v3).sort());
  });

  it("toda linha acrescentada na V4 está na lista autorizada, e toda linha autorizada da V4 foi acrescentada", () => {
    assert.deepEqual([...added].sort(), AUTHORIZED.flatMap((c) => c.v4).sort());
  });

  it("controle: o diff detecta uma linha não autorizada", () => {
    const v3 = read("../../v3/src/run.ts");
    const tampered = [...read("./run.ts"), "// linha nova não autorizada"];
    assert.ok(lineDiff(v3, tampered).added.includes("// linha nova não autorizada"));
  });

  it("resumo por categoria", () => {
    const byCategory = new Map<Category, number>();
    for (const c of AUTHORIZED) byCategory.set(c.category, (byCategory.get(c.category) ?? 0) + Math.max(c.v3.length, c.v4.length));
    console.log(`  linhas por categoria: ${[...byCategory].map(([k, v]) => `${k} ${v}`).join("; ")}`);
    console.log(`  removidas da V3: ${removed.length}; acrescentadas na V4: ${added.length}`);
    assert.ok(removed.length > 0 && added.length > 0);
  });
});
