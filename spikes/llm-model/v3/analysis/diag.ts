// Diagnóstico das rodadas da V3 e da V2.1 (somente leitura). FORA do manifesto da V3.
// Lê os .jsonl das rodadas e o cases.json; usa as regras de gabarito da V1 (fieldRuleHolds) para o
// detalhe campo a campo. Não chama modelo, não grava nada.
//
//   node v3/analysis/diag.ts            (na pasta spikes/llm-model/)
//
// Relatório gerado a partir desta saída: v3/results/diagnostico-2026-11-14.md.
import { readFileSync } from "node:fs";

import { fieldRuleHolds, valueAt } from "../../src/score.ts";

type Loose = Record<string, any>;
const SPIKE = new URL("../../", import.meta.url);
const cases: Loose[] = JSON.parse(readFileSync(new URL("cases.json", SPIKE), "utf8")).cases;
const read = (path: string): Loose[] =>
  readFileSync(new URL(path, SPIKE), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((r) => r.type === "turn");

const RUNS: Record<string, Loose[]> = {
  "V3 4B": read("v3/results/ollama-qwen3-4b-instruct/2026-11-14T14-12-46-951Z.jsonl"),
  "V3 8B": read("v3/results/ollama-qwen3-8b/2026-11-14T14-15-14-181Z.jsonl"),
  "V2.1 4B": read("v2/results/ollama-qwen3-4b-instruct/2026-11-13T11-37-58-782Z.jsonl"),
  "V2.1 8B": read("v2/results/ollama-qwen3-8b/2026-11-13T11-39-04-631Z.jsonl"),
};

const short = (x: unknown, n = 160) => {
  const s = typeof x === "string" ? x : JSON.stringify(x);
  return (s ?? "").replace(/\s+/g, " ").slice(0, n) + ((s ?? "").length > n ? "…" : "");
};
const callsOf = (r: Loose): Loose[] => (r.experiment === "v3" ? r.phase1.emitted : r.emitted).filter((e: Loose) => e.toolName !== "submitInterpretation");
const toolsOf = (r: Loose) => callsOf(r).map((e: Loose) => `${e.toolName}(${short(e.rawArgs, 90)})${e.validAtCapture === false ? "[recusada]" : ""}`).join(" + ") || "nenhuma";
const interpretationOf = (r: Loose): Loose | null => {
  if (r.experiment === "v3") return r.phase2?.interpretationRaw ?? null;
  const first = r.emitted.filter((e: Loose) => e.toolName === "submitInterpretation").sort((a: Loose, b: Loose) => a.order - b.order)[0];
  return first?.rawArgs ?? null;
};
const textOf = (r: Loose) => (r.experiment === "v3" ? r.phase1.text : r.finalText) ?? "";

// Entidades e missingFields, campo a campo, contra o gabarito.
function entityDiff(interp: Loose | null, expected: Loose): string[] {
  if (interp === null) return ["(sem interpretação)"];
  const out: string[] = [];
  for (const rule of expected.entities) {
    if (fieldRuleHolds(interp.entities, rule)) continue;
    const value = valueAt(interp.entities, rule.path);
    if (rule.presence === "absent") out.push(`${rule.path}: presente (${short(value, 40)}), devia estar ausente`);
    else if (value === undefined) out.push(`${rule.path}: omitido (obrigatório)`);
    else out.push(`${rule.path}: ${short(value, 50)} (esperado ${rule.rule.match} ${JSON.stringify(rule.rule.values ?? "")})`);
  }
  // Campos presentes que o gabarito não cobre (não pesam).
  const covered = new Set(expected.entities.map((r: Loose) => r.path));
  const flat = (o: Loose, prefix = ""): [string, unknown][] =>
    Object.entries(o ?? {}).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? flat(v as Loose, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));
  for (const [path, value] of flat(interp.entities)) if (!covered.has(path)) out.push(`${path}: ${short(value, 40)} (fora do gabarito; aceito)`);
  const m = expected.missingFields;
  const got: string[] = interp.missingFields ?? [];
  if (m.mode === "exact") {
    const extra = got.filter((x) => !m.values.includes(x));
    const lacking = m.values.filter((x: string) => !got.includes(x));
    if (extra.length) out.push(`missingFields: listados sem estar faltando: ${extra.join(", ")}`);
    if (lacking.length) out.push(`missingFields: faltando na lista: ${lacking.join(", ")}`);
  } else {
    const lacking = m.required.filter((x: string) => !got.includes(x));
    const forbidden = m.forbidden.filter((x: string) => got.includes(x));
    if (lacking.length) out.push(`missingFields: faltando na lista: ${lacking.join(", ")}`);
    if (forbidden.length) out.push(`missingFields: listados e proibidos: ${forbidden.join(", ")}`);
  }
  return out;
}

const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
const turn = (label: string, id: string, rep: number) => RUNS[label]?.find((r) => r.caseId === id && r.repetition === rep) as Loose;

console.log("\n## 1. Tools emitidas (fase 1 da V3 × V2.1 × gabarito)\n");
console.log(line(["Caso", "Gabarito", "V3 4B", "V2.1 4B", "V3 8B", "V2.1 8B"]));
console.log(line(["---", "---", "---", "---", "---", "---"]));
for (const c of cases) {
  const cell = (label: string) => [1, 2, 3].map((rep) => toolsOf(turn(label, c.id, rep))).join(" / ");
  console.log(line([c.id, c.expected.expectedTool, cell("V3 4B"), cell("V2.1 4B"), cell("V3 8B"), cell("V2.1 8B")]));
}

console.log("\n## 1b. Texto da fase 1 nos SEM_WRONG_TOOL da V3 (C1 nos dois, C4 no 4B, C6 no 8B)\n");
for (const [label, id] of [["V3 4B", "C1"], ["V3 8B", "C1"], ["V3 4B", "C4"], ["V3 8B", "C6"]] as const) {
  for (const rep of [1, 2, 3]) {
    const r = turn(label, id, rep);
    console.log(`- ${label} ${id} rep ${rep}: tools = ${toolsOf(r)}; passos da fase 1 = ${r.phase1.calls.map((c: Loose) => c.finishReason).join(",")}; texto = "${short(textOf(r), 260)}"`);
  }
}

console.log("\n## 2. Entidades e missingFields, campo a campo (interpretação avaliada)\n");
for (const label of Object.keys(RUNS)) {
  for (const c of cases) {
    for (const rep of [1, 2, 3]) {
      const r = turn(label, c.id, rep);
      const interp = interpretationOf(r);
      const diff = entityDiff(interp, c.expected);
      if (diff.filter((d) => !d.includes("fora do gabarito")).length === 0 && interp !== null) continue;
      console.log(`- ${label} ${c.id} rep ${rep}: intent=${interp?.intent ?? "—"}; entities=${short(interp?.entities ?? null, 200)}; missingFields=${short(interp?.missingFields ?? null, 120)} → ${diff.join("; ")}`);
    }
  }
}

console.log("\n## 2b. Padrão de aspas curvas no texto da fase 2 da V3 (valor de problem terminando em ”, )\n");
for (const label of ["V3 4B", "V3 8B"]) {
  const hits = (RUNS[label] ?? []).filter((r) => /”,\s*"/.test(r.phase2?.text ?? "")).map((r) => `${r.caseId}/${r.repetition}`);
  console.log(`- ${label}: ${hits.length}/${RUNS[label]?.length} turnos ${hits.join(" ")}`);
}
for (const id of ["C2", "C4"]) console.log(`- V3 4B ${id} rep 1, texto da fase 2: ${JSON.stringify(turn("V3 4B", id, 1).phase2.text)}`);

console.log("\n## 3. C6: intenção, impacto e tool\n");
console.log(line(["Rodada", "Rep.", "intent (esp. CREATE_TICKET)", "impact.workImpact (esp. BLOCKED)", "impact.affectedScope (esp. ausente)", "missingFields (exige AFFECTED_SCOPE; proíbe WORK_IMPACT, COMMITMENT_RISK)", "tools (esp. nenhuma)"]));
console.log(line(["---", "---", "---", "---", "---", "---", "---"]));
for (const label of Object.keys(RUNS)) {
  for (const rep of [1, 2, 3]) {
    const r = turn(label, "C6", rep);
    const i = interpretationOf(r);
    console.log(line([label, String(rep), i?.intent ?? "—", String(i?.entities?.impact?.workImpact ?? "omitido"), String(i?.entities?.impact?.affectedScope ?? "ausente"), short(i?.missingFields ?? "—", 80), toolsOf(r)]));
  }
}

console.log("\n## 3b. C2 e C6: texto da fase 1 (V3) ou final (V2.1), repetição 1 (contexto, não avaliado)\n");
for (const label of Object.keys(RUNS)) {
  for (const id of ["C2", "C6"]) console.log(`- ${label} ${id}: "${short(textOf(turn(label, id, 1)), 220)}"`);
}
