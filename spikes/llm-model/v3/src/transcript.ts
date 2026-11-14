// Transcrição da fase 1 para a fase 2 e transcrição fiel (I10). v3/CRITERIA.md, "Transcrição da
// fase 1 para a fase 2" e "Transcrição fiel (I10)". Funções puras: nenhuma E/S.

import { redactToolArgs } from "../../v2/src/leak.ts";
import type { EmittedCall } from "../../v2/src/record.ts";
import { canonicalJson } from "../../v2/src/score.ts";
import type { FidelityReport } from "./record.ts";

type Loose = Record<string, unknown>;
const asLoose = (value: unknown): Loose => (typeof value === "object" && value !== null ? (value as Loose) : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const AMBIGUOUS_RESULTS = "RESULT_ASSOCIATION_AMBIGUOUS_DUPLICATE_ID";

const partsOf = (message: unknown): Loose[] => asArray(asLoose(message)["content"]).map(asLoose);
const hasToolCall = (message: unknown): boolean => partsOf(message).some((p) => p["type"] === "tool-call");

// Filtro (v3/CRITERIA.md, "Transcrição"): preserva inteiras as mensagens assistant com tool calls
// (inclusive o texto intermediário) e as mensagens tool; remove as partes de raciocínio de todas
// as mensagens; exclui a última mensagem assistant sem tool call (o texto final da fase 1).
export function filterTranscript(responseMessages: readonly unknown[]): unknown[] {
  const filtered: Loose[] = responseMessages.map((message) => {
    const m = asLoose(message);
    if (!Array.isArray(m["content"])) return { ...m };
    return { ...m, content: (m["content"] as unknown[]).filter((part) => asLoose(part)["type"] !== "reasoning") };
  });
  const last = filtered.at(-1);
  if (last !== undefined && last["role"] === "assistant" && !hasToolCall(last)) filtered.pop();
  // Uma mensagem assistant que só tinha raciocínio fica vazia: não vai para a fase 2.
  return filtered.filter((m) => !(m["role"] === "assistant" && Array.isArray(m["content"]) && (m["content"] as unknown[]).length === 0));
}

export function transcriptCounts(transcript: readonly unknown[]) {
  return {
    messages: transcript.length,
    assistantWithToolCalls: transcript.filter((m) => asLoose(m)["role"] === "assistant" && hasToolCall(m)).length,
    toolMessages: transcript.filter((m) => asLoose(m)["role"] === "tool").length,
  };
}

interface Call {
  id: string | null;
  name: string;
  args: unknown;
}
interface Result {
  id: string | null;
  // null quando o formato não traz o nome (mensagem tool do corpo compatível com OpenAI).
  name: string | null;
  // Conteúdo normalizado para comparação (normalizeContent).
  content: string;
}
interface Step {
  calls: Call[];
  results: Result[];
}

// Conteúdo de resultado: string → JSON.parse + canonicalJson, ou a string como está.
export function normalizeContent(value: unknown): string {
  if (typeof value === "string") {
    try {
      return canonicalJson(JSON.parse(value));
    } catch {
      return value;
    }
  }
  return canonicalJson(value);
}

// Saída de tool no formato do AI SDK ({ type: "json" | "text" | "error-text" | "error-json", value }).
function outputContent(output: unknown): string {
  const o = asLoose(output);
  return "value" in o ? normalizeContent(o["value"]) : normalizeContent(output);
}

// Passos da transcrição: cada mensagem assistant com tool calls abre um passo; as mensagens tool
// seguintes trazem os resultados dele.
export function transcriptSteps(transcript: readonly unknown[]): Step[] {
  const steps: Step[] = [];
  for (const message of transcript) {
    const m = asLoose(message);
    if (m["role"] === "assistant" && hasToolCall(m)) {
      steps.push({
        calls: partsOf(m)
          .filter((p) => p["type"] === "tool-call")
          .map((p) => ({ id: typeof p["toolCallId"] === "string" ? p["toolCallId"] : null, name: String(p["toolName"] ?? ""), args: p["input"] ?? p["args"] })),
        results: [],
      });
    } else if (m["role"] === "tool") {
      const step = steps.at(-1);
      const results = partsOf(m)
        .filter((p) => p["type"] === "tool-result")
        .map((p) => ({ id: typeof p["toolCallId"] === "string" ? p["toolCallId"] : null, name: String(p["toolName"] ?? ""), content: outputContent(p["output"]) }));
      if (step === undefined) steps.push({ calls: [], results });
      else step.results.push(...results);
    }
  }
  return steps;
}

function countBy(keys: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const key of keys) m.set(key, (m.get(key) ?? 0) + 1);
  return m;
}
const sameMultiset = (a: readonly string[], b: readonly string[]) => {
  const ma = countBy(a);
  const mb = countBy(b);
  return ma.size === mb.size && [...ma].every(([k, n]) => mb.get(k) === n);
};
const idsUsable = (...lists: { id: string | null }[][]) => lists.every((list) => list.every((x) => x.id !== null) && new Set(list.map((x) => x.id)).size === list.length);

// Compara as chamadas de dois lados de um passo: por id (ids presentes e únicos) ou, no modo
// alternativo, por multiconjunto de nome + argumentos canônicos.
function compareCalls(where: string, left: Call[], right: Call[], report: FidelityReport): void {
  if (left.length !== right.length) {
    report.violations.push(`${where}: ${left.length} chamada(s) × ${right.length}`);
    return;
  }
  if (idsUsable(left, right)) {
    for (const l of left) {
      const r = right.find((x) => x.id === l.id);
      if (r === undefined) report.violations.push(`${where}: chamada ${l.id} (${l.name}) ausente do outro lado`);
      else if (r.name !== l.name) report.violations.push(`${where}: id ${l.id} associado a ${l.name} × ${r.name}`);
      else if (canonicalJson(r.args) !== canonicalJson(l.args)) report.violations.push(`${where}: argumentos de ${l.name} (${l.id}) divergem`);
    }
    return;
  }
  report.diagnostics.push(`${where}: id ausente ou duplicado; chamadas comparadas no modo alternativo (nome + argumentos)`);
  const key = (c: Call) => `${c.name}|${canonicalJson(c.args)}`;
  if (!sameMultiset(left.map(key), right.map(key))) report.violations.push(`${where}: multiconjunto de chamadas (nome + argumentos) diverge`);
}

// Resultados × chamadas do mesmo lado (A) ou resultados × resultados (B).
function compareResults(where: string, calls: Call[], left: Result[], right: Result[] | null, report: FidelityReport): void {
  const other = right ?? left;
  if (left.length !== calls.length || other.length !== calls.length) {
    report.violations.push(`${where}: ${calls.length} chamada(s), ${left.length} resultado(s)${right === null ? "" : ` × ${right.length}`}`);
    return;
  }
  const nameOf = (r: Result) => r.name ?? calls.find((c) => c.id === r.id)?.name ?? null;
  if (idsUsable(calls, left, other)) {
    for (const call of calls) {
      const l = left.find((x) => x.id === call.id);
      const r = other.find((x) => x.id === call.id);
      if (l === undefined || r === undefined) {
        report.violations.push(`${where}: resultado de ${call.name} (${call.id}) ausente`);
        continue;
      }
      if (nameOf(l) !== call.name || nameOf(r) !== call.name) report.violations.push(`${where}: resultado do id ${call.id} associado ao nome errado`);
      else if (right !== null && l.content !== r.content) report.violations.push(`${where}: resultado de ${call.name} (${call.id}) diverge`);
    }
    return;
  }
  // Id ausente ou duplicado: a associação individual não pode ser comprovada.
  report.diagnostics.push(`${where}: ${AMBIGUOUS_RESULTS}`);
  if (right === null) {
    const named = left.map((r) => r.name ?? "");
    if (!sameMultiset(named, calls.map((c) => c.name))) report.violations.push(`${where}: multiconjunto de nomes dos resultados diverge das chamadas`);
  } else if (!sameMultiset(left.map((r) => r.content), right.map((r) => r.content))) {
    report.violations.push(`${where}: multiconjunto de conteúdos dos resultados diverge`);
  }
}

// Comparação A: captura da fase 1 (emissões do TurnProtocol) × transcrição filtrada. Os argumentos
// da emissão já vêm com o raciocínio removido (leak.ts); a mesma remoção é aplicada à transcrição.
export function fidelityA(emitted: readonly EmittedCall[], transcript: readonly unknown[]): FidelityReport {
  const report: FidelityReport = { violations: [], diagnostics: [] };
  const byStep = new Map<number, EmittedCall[]>();
  for (const call of [...emitted].sort((a, b) => a.order - b.order)) byStep.set(call.step, [...(byStep.get(call.step) ?? []), call]);
  const captured = [...byStep.entries()].sort(([a], [b]) => a - b).map(([, calls]) => calls);
  const steps = transcriptSteps(transcript);
  if (captured.length !== steps.length) {
    report.violations.push(`A: ${captured.length} passo(s) com emissões × ${steps.length} passo(s) na transcrição`);
    return report;
  }
  captured.forEach((calls, k) => {
    const step = steps[k] as Step;
    const where = `A, passo ${k + 1}`;
    const left: Call[] = calls.map((c) => ({ id: c.toolCallId, name: c.toolName, args: c.rawArgs }));
    const right: Call[] = step.calls.map((c) => ({ ...c, args: redactToolArgs(c.name, c.args).value }));
    compareCalls(where, left, right, report);
    compareResults(where, step.calls, step.results, null, report);
  });
  return report;
}

// Projeção do corpo da fase 2: o sufixo a partir do índice N (mensagens da primeira requisição da
// fase 1: sistema + histórico do caso serializado, até a entrada do funcionário).
export function fidelityB(transcript: readonly unknown[], bodyMessages: readonly unknown[], n: number | null): FidelityReport {
  const report: FidelityReport = { violations: [], diagnostics: [] };
  if (n === null || n < 1) {
    report.violations.push("B: fronteira N desconhecida (primeira requisição da fase 1 não capturada)");
    return report;
  }
  if (asLoose(bodyMessages[n - 1])["role"] !== "user") report.violations.push(`B: a mensagem de índice N − 1 (${n - 1}) não é a user do funcionário`);
  const bodySteps: Step[] = [];
  bodyMessages.slice(n).forEach((message, i) => {
    const m = asLoose(message);
    const where = `B, mensagem ${n + i}`;
    if (m["role"] === "assistant") {
      const toolCalls = asArray(m["tool_calls"]).map(asLoose);
      if (toolCalls.length === 0) {
        report.violations.push(`${where}: assistant sem tool_calls no sufixo`);
        return;
      }
      bodySteps.push({
        calls: toolCalls.map((c) => {
          const fn = asLoose(c["function"]);
          let args: unknown = fn["arguments"];
          try {
            args = JSON.parse(String(fn["arguments"]));
          } catch {
            // argumentos que não são JSON: comparados como vieram
          }
          return { id: typeof c["id"] === "string" ? c["id"] : null, name: String(fn["name"] ?? ""), args };
        }),
        results: [],
      });
    } else if (m["role"] === "tool") {
      const step = bodySteps.at(-1);
      const result = { id: typeof m["tool_call_id"] === "string" ? m["tool_call_id"] : null, name: null, content: normalizeContent(m["content"]) };
      if (step === undefined) report.violations.push(`${where}: tool antes de qualquer assistant com tool_calls`);
      else step.results.push(result);
    } else {
      report.violations.push(`${where}: mensagem ${String(m["role"])} dentro do sufixo`);
    }
  });
  const steps = transcriptSteps(transcript);
  if (steps.length !== bodySteps.length) {
    report.violations.push(`B: ${steps.length} passo(s) na transcrição × ${bodySteps.length} no corpo`);
    return report;
  }
  steps.forEach((step, k) => {
    const body = bodySteps[k] as Step;
    const where = `B, passo ${k + 1}`;
    compareCalls(where, step.calls, body.calls, report);
    compareResults(where, step.calls, step.results, body.results, report);
  });
  return report;
}
