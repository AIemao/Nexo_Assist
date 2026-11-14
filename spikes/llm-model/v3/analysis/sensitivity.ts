// Verificação de sensibilidade (somente leitura; FORA do manifesto da V3). Não altera nem reescreve
// nenhum resultado oficial: lê os .jsonl das rodadas da V3 e recalcula, EM MEMÓRIA, a pontuação com
// as funções da V3 (scoreTurnV3, aggregateV3, que usam o scoreTurn e o aggregate da V1), em duas
// variantes:
//   oficial  : gabarito e registro como estão;
//   relaxada : (a) C4 sem a exigência de category nos argumentos de proposeTicketDraft;
//              (b) C6 ignorando chamadas de tool de leitura (searchArticles, listMyTickets).
// Os dois pontos foram apontados pela auditoria dos casos como divergentes da especificação.
//
//   node v3/analysis/sensitivity.ts            (na pasta spikes/llm-model/)
import { readFileSync } from "node:fs";

import { aggregateV3, scoreTurnV3 } from "../src/score.ts";
import type { TurnRecordV3 } from "../src/record.ts";

type Loose = Record<string, any>;
const SPIKE = new URL("../../", import.meta.url);
const cases: Loose[] = JSON.parse(readFileSync(new URL("cases.json", SPIKE), "utf8")).cases;
const read = (path: string): TurnRecordV3[] =>
  readFileSync(new URL(path, SPIKE), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((r) => r.type === "turn");

const RUNS: Record<string, TurnRecordV3[]> = {
  "V3 4B": read("v3/results/ollama-qwen3-4b-instruct/2026-11-14T14-12-46-951Z.jsonl"),
  "V3 8B": read("v3/results/ollama-qwen3-8b/2026-11-14T14-15-14-181Z.jsonl"),
};
const READ_TOOLS = ["searchArticles", "listMyTickets"];

// (a) C4: gabarito sem a regra de category nos argumentos.
const relaxCase = (c: Loose): Loose =>
  c.id === "C4" && c.expected.toolArgs ? { ...c, expected: { ...c.expected, toolArgs: { ...c.expected.toolArgs, fields: c.expected.toolArgs.fields.filter((f: Loose) => f.path !== "category") } } } : c;
// (b) C6: registro sem as chamadas de tool de leitura na fase 1.
const relaxRecord = (r: TurnRecordV3): TurnRecordV3 =>
  r.caseId === "C6" ? { ...r, phase1: { ...r.phase1, emitted: r.phase1.emitted.filter((e) => !READ_TOOLS.includes(e.toolName)) } } : r;

const caseOf = (id: string) => cases.find((c) => c.id === id) as Loose;
const failed = (s: ReturnType<typeof scoreTurnV3>) => {
  const v = s.v1;
  const out: string[] = [];
  if (v.execCode) out.push(v.execCode);
  if (!v.zodValid) out.push("Zod");
  if (!v.intentCorrect) out.push("intenção");
  if (!v.toolCorrect) out.push("tool");
  if (!v.entitiesCorrect) out.push("entidades/missingFields");
  if (v.c6Expected === false) out.push("C6");
  return out;
};
const line = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;

console.log("\n## 1–2. Critérios que reprovaram cada turno de C4 e C6 (oficial × relaxada)\n");
console.log(line(["Modelo", "Caso", "Rep.", "Tools da fase 1", "Reprovou em (oficial)", "Códigos (oficial)", "Reprovou em (relaxada)", "Reprovou SÓ por (a) ou (b)?"]));
console.log(line(["---", "---", "---", "---", "---", "---", "---", "---"]));
for (const [label, run] of Object.entries(RUNS)) {
  for (const id of ["C4", "C6"]) {
    for (const rep of [1, 2, 3]) {
      const r = run.find((x) => x.caseId === id && x.repetition === rep) as TurnRecordV3;
      const official = scoreTurnV3(r, caseOf(id) as never);
      const relaxed = scoreTurnV3(relaxRecord(r), relaxCase(caseOf(id)) as never);
      const fo = failed(official);
      const fr = failed(relaxed);
      const onlyAB = fo.length > 0 && fr.length === 0;
      const tools = r.phase1.emitted.map((e) => e.toolName).join(", ") || "nenhuma";
      console.log(line([label, id, rep, tools, fo.join(", ") || "—", official.codes.join(", ") || "—", fr.join(", ") || "—", onlyAB ? "**sim**" : "não"]));
    }
  }
}

console.log("\n## 3. Contagens do CRITERIA da V3 (18 turnos por candidato): oficial × relaxada\n");
console.log(line(["Modelo", "Limite", "Oficial", "Relaxada", "Muda?"]));
console.log(line(["---", "---", "---", "---", "---"]));
for (const [label, run] of Object.entries(RUNS)) {
  const off = aggregateV3(cases as never, run.map((r) => scoreTurnV3(r, caseOf(r.caseId) as never)));
  const rel = aggregateV3(cases.map(relaxCase) as never, run.map((r) => scoreTurnV3(relaxRecord(r), relaxCase(caseOf(r.caseId)) as never)));
  const rows: [string, string, string][] = [
    ["Interpretação válida (Zod)", `${off.zodValid.count}`, `${rel.zodValid.count}`],
    ["Intenção correta (total; maioria)", `${off.intent.count}; ${off.intent.majorityCases}`, `${rel.intent.count}; ${rel.intent.majorityCases}`],
    ["Tool de negócio correta (total; maioria)", `${off.tool.count}; ${off.tool.majorityCases}`, `${rel.tool.count}; ${rel.tool.majorityCases}`],
    ["Entidades e missingFields", `${off.entities.count}`, `${rel.entities.count}`],
    ["Estabilidade (3 iguais; mínimo nas demais)", `${off.stability.allSameCases}; ${off.stability.othersMinConcordance ?? "—"}`, `${rel.stability.allSameCases}; ${rel.stability.othersMinConcordance ?? "—"}`],
    ["C6", `${off.c6.count}/3`, `${rel.c6.count}/3`],
    ["Tolerância zero", off.zeroTolerance.pass ? "aprovado" : "reprovado", rel.zeroTolerance.pass ? "aprovado" : "reprovado"],
    ["Nos limites", off.approvedOnThresholds ? "aprovado" : "reprovado", rel.approvedOnThresholds ? "aprovado" : "reprovado"],
  ];
  for (const [name, o, r] of rows) console.log(line([label, name, o, r, o === r ? "não" : "**sim**"]));
}
