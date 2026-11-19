// Linha de base da V4 (v4/CRITERIA.md, "Linha de base (repontuação da V3)", "Leitura dos
// resultados", passo 4 da "Ordem de trabalho"). Somente leitura dos registros oficiais da V3; nenhum
// modelo. Grava só v4/results/linha-de-base-2026-11-16.md; nada é gravado em v3/.
//
//   node v4/baseline/rescore.ts            (na pasta spikes/llm-model/)
//
// Antes de pontuar: manifesto da V3 (33/33) e os 9 hashes da tabela de congelamento da V4. Se algum
// divergir, para sem gravar nada. Os hashes dos registros são conferidos no início e no fim.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import type { CasesFile } from "../../src/cases-schema.ts";
import type { Aggregate } from "../../src/score.ts";
import type { RunHeaderV3, TurnRecordV3 } from "../../v3/src/record.ts";
import { summaryMarkdown, verifyManifestV3 } from "../../v3/src/run.ts";
import { aggregateV3, scoreTurnV3, type TurnScoreV3 } from "../../v3/src/score.ts";
import { loadCasesV4, readRootCases } from "../src/cases.ts";
import { aggregateV4, c6V3, c6V4, scoreTurnV4, type C6Rule, type SearchCallDiagnostic, type TurnScoreV4 } from "../src/score.ts";

type Case = CasesFile["cases"][number];

const SPIKE = new URL("../../", import.meta.url);
export const REPORT_DATE = "2026-11-16";
export const REPORT_URL = new URL(`v4/results/linha-de-base-${REPORT_DATE}.md`, SPIKE);
export const OFFICIAL_RUNS = [
  "v3/results/ollama-qwen3-4b-instruct/2026-11-14T14-12-46-951Z",
  "v3/results/ollama-qwen3-8b/2026-11-14T14-15-14-181Z",
] as const;
// Tabela de congelamento da V4 (v4/CRITERIA.md, "Ordem de trabalho", passo 3).
export const FROZEN_FILES = [
  "v4/expected.json",
  "v4/src/cases.ts",
  "v4/src/catalog-check.ts",
  "v4/src/score.ts",
  "v4/tsconfig.json",
  "v4/src/cases.test.ts",
  "v4/src/catalog-check.test.ts",
  "v4/src/score.test.ts",
  "v4/src/equivalence.test.ts",
] as const;

export const sha256Of = (path: string): string => createHash("sha256").update(readFileSync(new URL(path, SPIKE))).digest("hex");

// ---------------------------------------------------------------------------
// Verificações prévias.

export interface FileCheck {
  file: string;
  expected: string | null;
  actual: string;
  ok: boolean;
}

// Tabela de congelamento: hash sem crases, fora do formato que a CLI lê como manifesto
// (v4/CRITERIA.md, "Ajustes da implementação (Etapa 2B)", item 4).
export function verifyFrozenV4(criteriaText = readFileSync(new URL("v4/CRITERIA.md", SPIKE), "utf8")): FileCheck[] {
  const table = new Map([...criteriaText.matchAll(/\| `(v4\/[^`]+)` \| ([0-9a-f]{64}) \|/g)].map(([, file = "", hash = ""]) => [file, hash]));
  return FROZEN_FILES.map((file) => {
    const expected = table.get(file) ?? null;
    const actual = sha256Of(file);
    return { file, expected, actual, ok: expected === actual };
  });
}

// ---------------------------------------------------------------------------
// Leitura e pontuação (funções puras sobre os registros lidos).

export interface OfficialRun {
  stem: string;
  header: RunHeaderV3;
  records: TurnRecordV3[];
  summary: string;
}

export function readOfficialRun(stem: string): OfficialRun {
  const lines = readFileSync(new URL(`${stem}.jsonl`, SPIKE), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { type: string });
  const header = lines.find((l) => l.type === "run") as unknown as RunHeaderV3 | undefined;
  if (header === undefined) throw new Error(`${stem}.jsonl sem linha "run"`);
  const records = lines.filter((l) => l.type === "turn") as unknown as TurnRecordV3[];
  return { stem, header, records, summary: readFileSync(new URL(`${stem}-summary.md`, SPIKE), "utf8") };
}

const caseIn = (cases: readonly Case[], id: string): Case => {
  const found = cases.find((c) => c.id === id);
  if (found === undefined) throw new Error(`caso desconhecido: ${id}`);
  return found;
};

type Metric = "Zod" | "intenção" | "tool" | "entidades e missingFields" | "C6";
const METRICS: [Metric, (s: TurnScoreV3) => boolean | null][] = [
  ["Zod", (s) => s.v1.zodValid],
  ["intenção", (s) => s.v1.intentCorrect],
  ["tool", (s) => s.v1.toolCorrect],
  ["entidades e missingFields", (s) => s.v1.entitiesCorrect],
  ["C6", (s) => s.v1.c6Expected],
];

// Diferenças do gabarito (v4/CRITERIA.md, "Diferenças em relação ao gabarito da V3" e "Critério C6
// (novo)"). Cada uma aplicada sozinha ao gabarito da V3, para identificar qual muda a métrica.
interface Difference {
  label: string;
  // Gabarito do caso com só esta diferença (null = a diferença é a regra do C6, não o gabarito).
  apply: ((v3: Case, v4: Case) => Case) | null;
}
const DIFFERENCES: Difference[] = [
  {
    label: "C6: expectedTool none → searchArticles (query obrigatória, conteúdo não avaliado)",
    apply: (v3, v4) => ({ ...v3, expected: { ...v3.expected, expectedTool: v4.expected.expectedTool, allowedExtraTools: v4.expected.allowedExtraTools, toolArgs: v4.expected.toolArgs } }),
  },
  {
    label: "C6: category nas entidades passa a absent",
    apply: (v3) => ({ ...v3, expected: { ...v3.expected, entities: [...v3.expected.entities, { path: "category", presence: "absent" }] } }),
  },
  {
    label: "C6: missingFields.required ganha CATEGORY",
    apply: (v3) => {
      const mf = v3.expected.missingFields;
      if (mf.mode !== "includes") throw new Error("C6 da V3 deveria usar includes");
      return { ...v3, expected: { ...v3.expected, missingFields: { ...mf, required: [...mf.required, "CATEGORY"] } } };
    },
  },
  {
    label: "C6: missingFields.forbidden ganha TYPE",
    apply: (v3) => {
      const mf = v3.expected.missingFields;
      if (mf.mode !== "includes") throw new Error("C6 da V3 deveria usar includes");
      return { ...v3, expected: { ...v3.expected, missingFields: { ...mf, forbidden: [...mf.forbidden, "TYPE"] } } };
    },
  },
  { label: "C6 novo: condição 5 (nenhuma tool de negócio) substituída pela segurança", apply: null },
];

export interface TurnChange {
  caseId: string;
  repetition: number;
  metric: Metric;
  v3: boolean | null;
  v4: boolean | null;
  causes: string[];
  codesV3: string[];
  codesV4: string[];
}

export interface Rescored {
  run: OfficialRun;
  v3: { scores: TurnScoreV3[]; aggregate: Aggregate };
  v4: { scores: TurnScoreV4[]; aggregate: Aggregate };
  changes: TurnChange[];
  c6Search: { repetition: number; search: SearchCallDiagnostic[] }[];
}

// Pontua os registros: V3 oficial (gabarito da raiz, scoreTurnV3) e V4 (gabarito e regra dados).
export function rescore(run: OfficialRun, casesV3: readonly Case[], casesV4: readonly Case[], c6Rule: C6Rule = c6V4): Rescored {
  const v3Scores = run.records.map((r) => scoreTurnV3(r, caseIn(casesV3, r.caseId)));
  const v4Scores = run.records.map((r) => scoreTurnV4(r, caseIn(casesV4, r.caseId), c6Rule));
  const changes: TurnChange[] = [];
  run.records.forEach((record, i) => {
    const before = v3Scores[i] as TurnScoreV3;
    const after = v4Scores[i] as TurnScoreV4;
    for (const [metric, pick] of METRICS) {
      if (pick(before) === pick(after)) continue;
      const causes = DIFFERENCES.filter((d) => {
        const variant =
          d.apply === null
            ? scoreTurnV4(record, caseIn(casesV3, record.caseId), c6Rule)
            : record.caseId === "C6"
              ? scoreTurnV4(record, d.apply(caseIn(casesV3, "C6"), caseIn(casesV4, "C6")), c6V3)
              : null;
        return variant !== null && pick(variant) !== pick(before);
      }).map((d) => d.label);
      changes.push({
        caseId: record.caseId,
        repetition: record.repetition,
        metric,
        v3: pick(before),
        v4: pick(after),
        causes: causes.length > 0 ? causes : ["nenhuma diferença isolada; só a combinação das diferenças muda a métrica"],
        codesV3: before.codes,
        codesV4: after.codes,
      });
    }
  });
  return {
    run,
    v3: { scores: v3Scores, aggregate: aggregateV3(casesV3, v3Scores) },
    v4: { scores: v4Scores, aggregate: aggregateV4(casesV4, v4Scores) },
    changes,
    c6Search: v4Scores.filter((s) => s.caseId === "C6").map((s) => ({ repetition: s.repetition, search: s.c6?.search ?? [] })),
  };
}

// O "V3 oficial" do relatório é o publicado: o resumo regenerado com a pontuação da V3 tem de ser
// idêntico ao *-summary.md oficial.
export function officialSummaryMatches(r: Rescored): boolean {
  return summaryMarkdown(r.run.header, r.run.records, r.v3.scores, r.v3.aggregate) === r.run.summary;
}

// ---------------------------------------------------------------------------
// Relatório.

const mark = (pass: boolean) => (pass ? "aprovado" : "**reprovado**");
const yn = (b: boolean | null) => (b === null ? "—" : b ? "sim" : "não");

function limitRows(a: Aggregate): [string, string][] {
  return [
    ["Interpretação válida (Zod)", `${a.zodValid.count} (${mark(a.zodValid.pass)})`],
    ["Intenção correta", `${a.intent.count}; maioria em ${a.intent.majorityCases} (${mark(a.intent.pass)})`],
    ["Tool de negócio correta", `${a.tool.count}; maioria em ${a.tool.majorityCases} (${mark(a.tool.pass)})`],
    ["Entidades e missingFields", `${a.entities.count} (${mark(a.entities.pass)})`],
    ["Estabilidade", `${a.stability.allSameCases} com 3 iguais; mínimo nas demais: ${a.stability.othersMinConcordance ?? "—"} (${mark(a.stability.pass)})`],
    ["C6", `${a.c6.count} de 3 (${mark(a.c6.pass)})`],
    [
      "Tolerância zero",
      `vazamentos ${a.zeroTolerance.reasoningLeaks}; efeitos externos ${a.zeroTolerance.externalEffects}; truncamento ${a.zeroTolerance.truncation.status} (${mark(a.zeroTolerance.pass)})`,
    ],
  ];
}
const REQUIRED = ["≥ 17", "≥ 15; ≥ 5", "≥ 15; ≥ 5", "≥ 15", "≥ 4; ≥ 2", "3", "0; NOT_DETECTED nos 18"];

function searchCell(search: SearchCallDiagnostic[]): string {
  return search
    .map((d) => {
      const at = d.order === null ? "" : ` (emissão ${d.order})`;
      if (d.state === "RESULTS") return `\`RESULTS\`${at}: ${(d.articles ?? []).join(", ")}`;
      if (d.state === "NOT_RECALCULABLE") return `\`NOT_RECALCULABLE\`${at}: ${d.reason ?? "—"}`;
      return `\`${d.state}\`${at}`;
    })
    .join("; ");
}

export function reportMarkdown(results: Rescored[], frozen: FileCheck[], recordHashes: Map<string, string>, manifestV3: { ok: number; total: number }): string {
  const lines: string[] = [
    `# Linha de base da V4 (${REPORT_DATE})`,
    "",
    "**Não oficial: repontuação dos registros oficiais da V3 com o gabarito e a régua da V4.** O resultado oficial da V3 continua o dos seus `*-summary.md`; o resultado oficial da V4 será o das rodadas da V4.",
    "",
    "Gerado por `v4/baseline/rescore.ts` (somente leitura dos registros oficiais; nenhum modelo). Regras: `v4/CRITERIA.md`, seções \"Linha de base (repontuação da V3)\" e \"Leitura dos resultados\".",
    "",
    "## Verificações",
    "",
    `- Manifesto da V3: ${manifestV3.ok}/${manifestV3.total}.`,
    `- Tabela de congelamento da V4: ${frozen.filter((f) => f.ok).length}/${frozen.length}.`,
    "- Hashes dos registros lidos conferidos no início e no fim da leitura: iguais.",
    "- Coluna \"V3 oficial\": o resumo regenerado com a pontuação da V3 é idêntico ao `*-summary.md` oficial, nos dois registros.",
    "",
    "### Arquivos congelados da V4",
    "",
    "| Arquivo | SHA-256 |",
    "| --- | --- |",
    ...frozen.map((f) => `| \`${f.file}\` | \`${f.actual}\` |`),
    "",
  ];

  for (const r of results) {
    const v3 = limitRows(r.v3.aggregate);
    const v4 = limitRows(r.v4.aggregate);
    lines.push(
      `## ${r.run.header.model}`,
      "",
      `- Registro lido: \`${r.run.stem}.jsonl\``,
      `- SHA-256: \`${recordHashes.get(r.run.stem) ?? "—"}\``,
      `- Turnos: ${r.run.records.length}`,
      "",
      "### Limites (denominador fixo de 18)",
      "",
      "| Limite | V3 oficial | Linha de base V4 | Exigido |",
      "| --- | --- | --- | --- |",
      ...v3.map(([name, before], i) => `| ${name} | ${before} | ${(v4[i] as [string, string])[1]} | ${REQUIRED[i]} |`),
      `| **Nos limites** | ${r.v3.aggregate.approvedOnThresholds ? "aprovado" : "reprovado"} | ${r.v4.aggregate.approvedOnThresholds ? "aprovado" : "reprovado"} | todos |`,
      "",
      "### Turnos cuja pontuação mudou",
      "",
    );
    if (r.changes.length === 0) {
      lines.push("Nenhum.", "");
    } else {
      lines.push(
        "| Caso | Rep. | Métrica | V3 oficial | Linha de base V4 | Diferença do gabarito | Códigos V3 | Códigos V4 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ...r.changes.map(
          (c) =>
            `| ${c.caseId} | ${c.repetition} | ${c.metric} | ${yn(c.v3)} | ${yn(c.v4)} | ${c.causes.join("<br>")} | ${c.codesV3.join(", ") || "—"} | ${c.codesV4.join(", ") || "—"} |`,
        ),
        "",
        "A diferença do gabarito é a que, aplicada sozinha ao gabarito da V3, muda a métrica naquele turno.",
        "",
      );
    }
    lines.push(
      "### Diagnóstico da busca no C6 (não pontua)",
      "",
      "| Rep. | Estado da busca |",
      "| --- | --- |",
      ...r.c6Search.map((s) => `| ${s.repetition} | ${searchCell(s.search)} |`),
      "",
      "### Veredito pelos limites",
      "",
      `Linha de base V4, pelos limites: **${r.v4.aggregate.approvedOnThresholds ? "aprovado" : "reprovado"}**. E1 a E4 são verificados fora do score.`,
      "",
    );
  }

  lines.push(
    "## Leitura dos resultados",
    "",
    "- A comparação com a linha de base é descritiva: as mesmas métricas, lado a lado, com o mesmo gabarito e a mesma régua. Ela não aprova nem reprova nenhum candidato; a aprovação vem só dos limites, nas rodadas da V4.",
    "- Este relatório registra só o que a régua mede; não atribui causa às falhas.",
    "",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI.

export function main(): number {
  const manifest = verifyManifestV3();
  const manifestOk = manifest.length === 33 && manifest.every((m) => m.ok);
  const frozen = verifyFrozenV4();
  const frozenOk = frozen.every((f) => f.ok);
  if (!manifestOk || !frozenOk) {
    console.error(`Verificação falhou; nada foi gravado. Manifesto da V3: ${manifest.filter((m) => m.ok).length}/${manifest.length}.`);
    for (const f of frozen.filter((x) => !x.ok)) console.error(`- congelado divergente: ${f.file} (tabela ${f.expected ?? "ausente"}, atual ${f.actual})`);
    return 1;
  }

  const before = new Map(OFFICIAL_RUNS.map((stem) => [stem, sha256Of(`${stem}.jsonl`)] as const));
  const casesV3 = readRootCases().cases;
  const casesV4 = loadCasesV4().cases;
  const results = OFFICIAL_RUNS.map((stem) => rescore(readOfficialRun(stem), casesV3, casesV4));
  const after = new Map(OFFICIAL_RUNS.map((stem) => [stem, sha256Of(`${stem}.jsonl`)] as const));

  const problems: string[] = [];
  for (const stem of OFFICIAL_RUNS) if (before.get(stem) !== after.get(stem)) problems.push(`registro alterado durante a leitura: ${stem}.jsonl`);
  for (const r of results) if (!officialSummaryMatches(r)) problems.push(`pontuação da V3 diferente do *-summary.md oficial: ${r.run.stem}`);
  if (!verifyFrozenV4().every((f) => f.ok)) problems.push("arquivo congelado da V4 alterado durante a execução");
  if (problems.length > 0) {
    console.error(`Verificação falhou; nada foi gravado.\n- ${problems.join("\n- ")}`);
    return 1;
  }

  mkdirSync(new URL(".", REPORT_URL), { recursive: true });
  writeFileSync(REPORT_URL, reportMarkdown(results, frozen, before, { ok: manifest.length, total: manifest.length }));
  console.log(`Gravado: v4/results/linha-de-base-${REPORT_DATE}.md`);
  return 0;
}

if (import.meta.main) process.exitCode = main();
