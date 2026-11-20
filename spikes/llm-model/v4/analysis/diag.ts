// Diagnóstico das rodadas oficiais da V4 (somente leitura). FORA do manifesto da V4.
// Lê os dois .jsonl da V4 (e, só para a latência, os dois da V3) e o gabarito composto da V4
// (loadCasesV4). A pontuação vem da régua oficial (scoreTurnV4, de v4/src/score.ts); o detalhe
// campo a campo usa fieldRuleHolds (src/score.ts). Não chama modelo, não grava nada.
//
//   node v4/analysis/diag.ts            (na pasta spikes/llm-model/)
//
// Relatório gerado a partir desta saída: v4/results/diagnostico-2026-11-20.md.
import { readFileSync } from "node:fs";

import { fieldRuleHolds, valueAt } from "../../src/score.ts";
import type { TurnRecordV3 } from "../../v3/src/record.ts";
import { loadCasesV4 } from "../src/cases.ts";
import { scoreTurnV4 } from "../src/score.ts";

type Loose = Record<string, any>;
const SPIKE = new URL("../../", import.meta.url);
const cases = loadCasesV4().cases;
const caseOf = (id: string) => cases.find((c) => c.id === id) as (typeof cases)[number];

const readRun = (path: string): { header: Loose; turns: Loose[] } => {
  const rows = readFileSync(new URL(path, SPIKE), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Loose);
  return { header: rows.find((r) => r.type === "run") as Loose, turns: rows.filter((r) => r.type === "turn") };
};

const FILES = {
  "V4 4B": "v4/results/ollama-qwen3-4b-instruct/2026-11-20T02-12-07-849Z.jsonl",
  "V4 8B": "v4/results/ollama-qwen3-8b/2026-11-20T02-18-41-270Z.jsonl",
  "V3 4B": "v3/results/ollama-qwen3-4b-instruct/2026-11-14T14-12-46-951Z.jsonl",
  "V3 8B": "v3/results/ollama-qwen3-8b/2026-11-14T14-15-14-181Z.jsonl",
} as const;
type Label = keyof typeof FILES;
const RUNS = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, readRun(p)])) as Record<Label, { header: Loose; turns: Loose[] }>;

const turn = (label: Label, id: string, rep: number) => RUNS[label].turns.find((r) => r.caseId === id && r.repetition === rep) as Loose;
const score = (label: Label, id: string, rep: number) => scoreTurnV4(turn(label, id, rep) as unknown as TurnRecordV3, caseOf(id));
const REPS = [1, 2, 3] as const;
const j = (x: unknown) => JSON.stringify(x);
const short = (x: unknown, n = 200) => {
  const s = typeof x === "string" ? x : JSON.stringify(x);
  return (s ?? "").replace(/\s+/g, " ").slice(0, n) + ((s ?? "").length > n ? "…" : "");
};
const tools = (r: Loose) =>
  r.phase1.emitted.map((e: Loose) => `${e.toolName}(${j(e.rawArgs)})${e.validAtCapture === false ? "[recusada]" : ""}`).join(" + ") || "nenhuma";
const p1Steps = (r: Loose) => r.phase1.calls.map((c: Loose) => `${c.finishReason}/${c.outputTokens}tok/${c.latencyMs}ms`).join(", ");
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Detalhe campo a campo de entities e missingFields contra o gabarito composto.
function entityDiff(interp: Loose | null, id: string): string[] {
  if (interp === null) return ["(sem interpretação)"];
  const expected = caseOf(id).expected;
  const out: string[] = [];
  for (const rule of expected.entities) {
    const ok = fieldRuleHolds(interp.entities, rule);
    const value = valueAt(interp.entities, rule.path);
    const want = rule.presence === "absent" ? "ausente" : `${rule.presence} ${rule.rule.match} ${j((rule.rule as Loose).values ?? "")}`;
    out.push(`${ok ? "ok " : "ERR"} ${rule.path} = ${value === undefined ? "(ausente)" : j(value)}; gabarito: ${want}`);
  }
  const m = expected.missingFields;
  const got: string[] = interp.missingFields ?? [];
  if (m.mode === "exact") {
    out.push(`missingFields exato ${j(m.values)}; devolvido ${j(got)}`);
    const extra = got.filter((x) => !m.values.includes(x as never));
    const lacking = m.values.filter((x) => !got.includes(x));
    if (extra.length) out.push(`  listados sem estar no gabarito: ${extra.join(", ")}`);
    if (lacking.length) out.push(`  faltando na lista: ${lacking.join(", ")}`);
  } else {
    out.push(`missingFields devolvido ${j(got)}; exige ${j(m.required)}; proíbe ${j(m.forbidden)}`);
    const lacking = m.required.filter((x) => !got.includes(x));
    const forbidden = m.forbidden.filter((x) => got.includes(x));
    out.push(`  exigidos ausentes: ${lacking.join(", ") || "nenhum"}; proibidos presentes: ${forbidden.join(", ") || "nenhum"}`);
  }
  return out;
}

// Detalhe campo a campo dos argumentos da tool esperada.
function argsDiff(r: Loose, id: string): string[] {
  const ta = caseOf(id).expected.toolArgs;
  if (ta === null) return ["(sem toolArgs no gabarito)"];
  const calls = r.phase1.emitted.filter((e: Loose) => e.toolName === caseOf(id).expected.expectedTool);
  if (calls.length === 0) return ["(tool esperada não emitida)"];
  return calls.flatMap((call: Loose, i: number) => [
    `chamada ${i + 1} (validAtCapture=${call.validAtCapture}):`,
    ...ta.fields.map((rule) => `  ${fieldRuleHolds(call.rawArgs, rule) ? "ok " : "ERR"} ${rule.path} = ${j(valueAt(call.rawArgs, rule.path))}`),
    `  proibidos presentes: ${ta.forbidden.filter((k) => Object.hasOwn(call.rawArgs ?? {}, k)).join(", ") || "nenhum"}`,
  ]);
}

// Detector barato de repetição: a janela de N caracteres mais frequente no texto.
function topWindow(text: string, n = 40): { window: string; count: number } {
  const counts = new Map<string, number>();
  for (let i = 0; i + n <= text.length; i++) {
    const w = text.slice(i, i + n);
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  let best = { window: "", count: 0 };
  for (const [window, count] of counts) if (count > best.count) best = { window, count };
  return best;
}
const occurrences = (text: string, needle: string) => text.split(needle).length - 1;

// ---------------------------------------------------------------------------
console.log("# Saída de v4/analysis/diag.ts\n");
console.log("## 0. Cabeçalhos das rodadas\n");
for (const label of Object.keys(RUNS) as Label[]) {
  const h = RUNS[label].header;
  console.log(`- ${label}: model=${h.model}; startedAt=${h.startedAt}; promptVersion=${h.promptVersion}; experiment=${h.experiment}; settings=${j(h.settings)}`);
}
console.log(`- experiment dos turnos V4: ${[...new Set([...RUNS["V4 4B"].turns, ...RUNS["V4 8B"].turns].map((t) => t.experiment))].join(", ")}`);

console.log("\n## 1. 8B, C4: missingFields e argumentos da proposeTicketDraft\n");
for (const rep of REPS) {
  const r = turn("V4 8B", "C4", rep);
  const s = score("V4 8B", "C4", rep);
  console.log(`### rep ${rep}: códigos ${j(s.codes)}; toolCorrect=${s.v1.toolCorrect}; entitiesCorrect=${s.v1.entitiesCorrect}`);
  console.log(`- interpretação: ${j(r.phase2.interpretationRaw)}`);
  for (const l of entityDiff(r.phase2.interpretationRaw, "C4")) console.log(`- ${l}`);
  console.log(`- tools fase 1: ${tools(r)}`);
  for (const l of argsDiff(r, "C4")) console.log(`- ${l}`);
  console.log(`- passos fase 1: ${p1Steps(r)}; texto fase 1: "${short(r.phase1.text, 300)}"`);
}

console.log("\n## 2. 8B, C6: entities, missingFields, condições do C6 e busca\n");
for (const rep of REPS) {
  const r = turn("V4 8B", "C6", rep);
  const s = score("V4 8B", "C6", rep);
  const i = r.phase2.interpretationRaw as Loose | null;
  console.log(`### rep ${rep}: códigos ${j(s.codes)}; c6Expected=${s.v1.c6Expected}; safety=${s.c6?.safety}; otherConditions=${s.c6?.otherConditions}`);
  console.log(
    `- subcondições (1–4, 6): execução sem EXEC=${s.v1.execCode === null}; Zod=${s.v1.zodValid}; workImpact BLOCKED=${i?.entities?.impact?.workImpact === "BLOCKED"}; affectedScope ausente=${i?.entities?.impact?.affectedScope === undefined}; AFFECTED_SCOPE no missing=${(i?.missingFields ?? []).includes("AFFECTED_SCOPE")}`,
  );
  console.log(`- interpretação: ${j(i)}`);
  for (const l of entityDiff(i, "C6")) console.log(`- ${l}`);
  console.log(`- tools fase 1: ${tools(r)}`);
  console.log(`- busca: ${j(s.c6?.search)}`);
  console.log(`- toolLog: ${j(r.phase1.toolLog)}`);
  console.log(`- passos fase 1: ${p1Steps(r)}; texto fase 1: "${short(r.phase1.text, 400)}"`);
}
console.log(`\n- 8B C6 rep 1, texto completo da fase 1: ${j(turn("V4 8B", "C6", 1).phase1.text)}`);
console.log(`- 8B C6, texto da fase 1 igual nas 3 repetições: ${new Set(REPS.map((rep) => turn("V4 8B", "C6", rep).phase1.text)).size === 1}`);
console.log(`- 8B C6 rep 1, texto da fase 2: ${j(turn("V4 8B", "C6", 1).phase2.text)}`);

console.log("\n## 3. 4B, turnos LENGTH (C2, C5): fase 2 e fase 1\n");
for (const id of ["C2", "C5"]) {
  for (const rep of REPS) {
    const r = turn("V4 4B", id, rep);
    const p2 = r.phase2 as Loose;
    const text: string = p2.text ?? "";
    let parsesWhole = false;
    try {
      JSON.parse(text);
      parsesWhole = true;
    } catch {}
    const top = topWindow(text);
    console.log(`### ${id} rep ${rep}: códigos ${j(score("V4 4B", id, rep).codes)}`);
    console.log(`- fase 2: finishReason=${p2.finishReason}; parse=${p2.parse}; zodValid=${p2.zodValid}; calls=${j(p2.calls)}; latência=${p2.latencyMs}ms`);
    console.log(`- texto: ${text.length} caracteres; JSON.parse do texto inteiro: ${parsesWhole ? "ok" : "falha"}; ocorrências de "intent": ${occurrences(text, '"intent"')}; de "{": ${occurrences(text, "{")}; de "}": ${occurrences(text, "}")}`);
    console.log(`- janela de 40 caracteres mais frequente: ${top.count}× ${j(top.window)}`);
    console.log(`- início (400): ${j(text.slice(0, 400))}`);
    console.log(`- fim (400): ${j(text.slice(-400))}`);
    console.log(`- zodIssues: ${short(p2.zodIssues, 300)}`);
    console.log(`- fase 1: tools ${tools(r)}; passos ${p1Steps(r)}; toolLog ${short(r.phase1.toolLog, 300)}`);
    console.log(`- texto fase 1: "${short(r.phase1.text, 500)}"`);
  }
}

console.log("\n## 4. 4B, C1: intenção, tool e fase 1\n");
for (const rep of REPS) {
  const r = turn("V4 4B", "C1", rep);
  console.log(`### rep ${rep}: códigos ${j(score("V4 4B", "C1", rep).codes)}`);
  console.log(`- interpretação: ${j(r.phase2.interpretationRaw)}`);
  for (const l of entityDiff(r.phase2.interpretationRaw, "C1")) console.log(`- ${l}`);
  console.log(`- tools fase 1: ${tools(r)}; passos ${p1Steps(r)}`);
  console.log(`- texto fase 1: "${short(r.phase1.text, 500)}"`);
}

console.log("\n## 5. 4B, C6: intenção e entidades\n");
for (const rep of REPS) {
  const r = turn("V4 4B", "C6", rep);
  const s = score("V4 4B", "C6", rep);
  console.log(`### rep ${rep}: códigos ${j(s.codes)}; c6Expected=${s.v1.c6Expected}; safety=${s.c6?.safety}; otherConditions=${s.c6?.otherConditions}`);
  console.log(`- interpretação: ${j(r.phase2.interpretationRaw)}`);
  for (const l of entityDiff(r.phase2.interpretationRaw, "C6")) console.log(`- ${l}`);
  console.log(`- tools fase 1: ${tools(r)}; busca: ${j(s.c6?.search)}`);
  console.log(`- passos fase 1: ${p1Steps(r)}; texto fase 1: "${short(r.phase1.text, 400)}"`);
}
console.log(`\n- 4B C6 rep 1, texto completo da fase 1: ${j(turn("V4 4B", "C6", 1).phase1.text)}`);

// Tokens por fase: entrada do 1º passo da fase 1, entrada da fase 2, saída somada de cada fase.
const tok = (r: Loose) => ({
  in1: r.phase1.calls[0]?.inputTokens ?? null,
  out1: r.phase1.calls.reduce((s: number, c: Loose) => s + (c.outputTokens ?? 0), 0),
  in2: r.phase2?.calls?.[0]?.inputTokens ?? null,
  out2: (r.phase2?.calls ?? []).reduce((s: number, c: Loose) => s + (c.outputTokens ?? 0), 0),
});

console.log("\n## 6. Latência por turno (ms): total, fase 1, fase 2\n");
for (const label of Object.keys(RUNS) as Label[]) {
  console.log(`### ${label}`);
  console.log("| Caso | Rep. | Turno | Fase 1 | Fase 2 | Passos fase 1 | Entrada 1º passo | Saída fase 1 | Entrada fase 2 | Saída fase 2 |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of RUNS[label].turns) {
    const t = tok(r);
    console.log(`| ${r.caseId} | ${r.repetition} | ${r.turnLatencyMs} | ${r.phase1.latencyMs} | ${r.phase2?.latencyMs ?? "—"} | ${r.phase1.calls.length} | ${t.in1} | ${t.out1} | ${t.in2} | ${t.out2} |`);
  }
}
console.log("\n### Tokens de entrada do 1º passo da fase 1, por caso (rep 1)\n");
console.log("| Caso | V3 4B | V4 4B | V3 8B | V4 8B |");
console.log("| --- | --- | --- | --- | --- |");
for (const c of cases) console.log(`| ${c.id} | ${(["V3 4B", "V4 4B", "V3 8B", "V4 8B"] as Label[]).map((l) => tok(turn(l, c.id, 1)).in1).join(" | ")} |`);
console.log("\n### Medianas\n");
console.log("| Rodada | Turno | Fase 1 | Fase 2 | Mín. turno | Máx. turno | Aquecimento |");
console.log("| --- | --- | --- | --- | --- | --- | --- |");
for (const label of Object.keys(RUNS) as Label[]) {
  const ts = RUNS[label].turns;
  const tot = ts.map((t) => t.turnLatencyMs as number);
  console.log(
    `| ${label} | ${median(tot)} | ${median(ts.map((t) => t.phase1.latencyMs))} | ${median(ts.filter((t) => t.phase2).map((t) => t.phase2.latencyMs))} | ${Math.min(...tot)} | ${Math.max(...tot)} | ${short(RUNS[label].header.warmup, 120)} |`,
  );
}
console.log("\n### Mediana do turno por caso (V3 → V4)\n");
console.log("| Caso | V3 4B | V4 4B | V3 8B | V4 8B |");
console.log("| --- | --- | --- | --- | --- |");
for (const c of cases) {
  const med = (label: Label) => median(RUNS[label].turns.filter((t) => t.caseId === c.id).map((t) => t.turnLatencyMs));
  console.log(`| ${c.id} | ${med("V3 4B")} | ${med("V4 4B")} | ${med("V3 8B")} | ${med("V4 8B")} |`);
}

console.log("\n## 7. Mesmos casos na V3 (rep 1): interpretação e tools, para contraste\n");
for (const id of ["C1", "C2", "C4", "C5", "C6"]) {
  for (const label of ["V3 4B", "V3 8B"] as Label[]) {
    const r = turn(label, id, 1);
    const same = new Set(REPS.map((rep) => j(turn(label, id, rep).phase2?.interpretationRaw))).size === 1;
    console.log(`- ${label} ${id}: tools ${tools(r)}; interpretação ${j(r.phase2?.interpretationRaw)}; igual nas 3: ${same}; finishReason fase 2: ${r.phase2?.finishReason}`);
  }
}

console.log("\n## 8. Mediana do turno sem os turnos com fase 2 em LENGTH\n");
for (const label of Object.keys(RUNS) as Label[]) {
  const ok = RUNS[label].turns.filter((t) => t.phase2?.finishReason !== "length");
  console.log(`- ${label}: ${ok.length} turnos; mediana do turno ${median(ok.map((t) => t.turnLatencyMs))} ms; da fase 1 ${median(ok.map((t) => t.phase1.latencyMs))} ms; da fase 2 ${median(ok.map((t) => t.phase2.latencyMs))} ms`);
}
