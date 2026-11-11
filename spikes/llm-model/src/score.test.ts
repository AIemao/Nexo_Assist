// Testes do score.ts com registros FABRICADOS (nenhum modelo). Rodar:
//   node --test src/score.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { casesFileSchema } from "./cases-schema.ts";
import type { BusinessTool, TurnRecord } from "./run-record.ts";
import { aggregate, scoreTurn, type TurnScore } from "./score.ts";

const cases = casesFileSchema.parse(JSON.parse(readFileSync(new URL("../cases.json", import.meta.url), "utf8"))).cases;
const caseById = (id: string) => {
  const found = cases.find((c) => c.id === id);
  if (found === undefined) throw new Error(`caso ${id} ausente`);
  return found;
};

// Interpretação e tools que satisfazem o gabarito de cada caso.
const PERFECT: Record<string, { interpretation: unknown; calls: { tool: BusinessTool; args: unknown }[] }> = {
  C1: {
    interpretation: { intent: "ANSWER_KB", confidence: "HIGH", entities: {}, missingFields: [] },
    calls: [{ tool: "searchArticles", args: { query: "horário de atendimento" } }],
  },
  C2: {
    interpretation: {
      intent: "ANSWER_KB",
      confidence: "HIGH",
      entities: { operatingSystem: "Windows 10", category: "NETWORK_VPN", problem: "Erro 809 na VPN" },
      missingFields: [],
    },
    calls: [{ tool: "searchArticles", args: { query: "VPN erro 809" } }],
  },
  C3: {
    interpretation: { intent: "LIST_MY_TICKETS", confidence: "HIGH", entities: {}, missingFields: [] },
    calls: [{ tool: "listMyTickets", args: {} }],
  },
  C4: {
    interpretation: { intent: "CREATE_TICKET", confidence: "HIGH", entities: { impact: { affectedScope: "SELF" } }, missingFields: [] },
    calls: [
      {
        tool: "proposeTicketDraft",
        args: {
          title: "Segundo monitor",
          description: "Pedido de um segundo monitor para o funcionário.",
          type: "REQ",
          category: "HARDWARE",
          impactAssessment: { affectedScope: "SELF", workImpact: "NONE", commitmentRisk: "NO" },
        },
      },
    ],
  },
  C5: {
    interpretation: { intent: "HANDOFF", confidence: "HIGH", entities: {}, missingFields: [] },
    calls: [{ tool: "requestHandoff", args: { reason: "Pediu um atendente humano." } }],
  },
  C6: {
    interpretation: {
      intent: "CREATE_TICKET",
      confidence: "MEDIUM",
      entities: { impact: { workImpact: "BLOCKED" }, problem: "Parou tudo" },
      missingFields: ["AFFECTED_SCOPE", "DESCRIPTION"],
    },
    calls: [],
  },
};

function record(caseId: string, repetition: number, override: Partial<TurnRecord> = {}): TurnRecord {
  const perfect = PERFECT[caseId];
  if (perfect === undefined) throw new Error(`sem registro perfeito para ${caseId}`);
  return {
    type: "turn",
    model: "fabricado",
    provider: "mock",
    caseId,
    repetition,
    startedAt: "2026-11-11T00:00:00.000Z",
    status: "completed",
    execError: null,
    attempts: 1,
    rateLimits: [],
    previousAttempts: [],
    businessToolCalls: perfect.calls.map((call) => ({ ...call, rejected: false })),
    syntheticToolCalls: [],
    otherToolCalls: [],
    toolLog: perfect.calls.map((call) => ({ tool: call.tool, args: call.args })),
    interpretationRaw: structuredClone(perfect.interpretation),
    zodValid: true,
    zodIssues: [],
    finalText: "Resposta.",
    reasoning: { separatePresent: false, leakedInText: false, leakedInInterpretation: false },
    calls: [{ index: 0, inputTokens: 2000, outputTokens: 100, latencyMs: 500, finishReason: "stop" }],
    totalInputTokens: 2000,
    totalOutputTokens: 100,
    turnLatencyMs: 500,
    finishReason: "stop",
    contextCheck: {
      status: "NOT_DETECTED",
      budget: 7680,
      maxReportedInputTokens: 2000,
      estimatedInputTokens: 1900,
      overBudget: false,
      suspectedSilentTruncation: false,
      unverified: false,
    },
    externalRequests: [],
    ...override,
  };
}

const CASE_IDS = ["C1", "C2", "C3", "C4", "C5", "C6"];

// 18 registros perfeitos; `change` permite trocar alguns.
function run18(change: (caseId: string, rep: number) => Partial<TurnRecord> | undefined = () => undefined): TurnScore[] {
  return CASE_IDS.flatMap((caseId) =>
    [1, 2, 3].map((rep) => scoreTurn(record(caseId, rep, change(caseId, rep) ?? {}), caseById(caseId))),
  );
}

const wrongIntent = (caseId: string): Partial<TurnRecord> => {
  const interpretation = structuredClone(PERFECT[caseId]?.interpretation) as { intent: string };
  interpretation.intent = interpretation.intent === "CLARIFY" ? "OUT_OF_SCOPE" : "CLARIFY";
  return { interpretationRaw: interpretation };
};

describe("scoreTurn", () => {
  it("registro perfeito: correto em todas as métricas, sem motivos", () => {
    for (const caseId of CASE_IDS) {
      const s = scoreTurn(record(caseId, 1), caseById(caseId));
      assert.deepEqual(
        [s.zodValid, s.intentCorrect, s.toolCorrect, s.entitiesCorrect, s.reasons],
        [true, true, true, true, []],
        caseId,
      );
    }
    assert.equal(scoreTurn(record("C6", 1), caseById("C6")).c6Expected, true);
  });

  it("Zod inválido conta nas métricas funcionais: intenção e entidades incorretas; tool julgada pelas chamadas", () => {
    const s = scoreTurn(record("C3", 1, { interpretationRaw: { intent: "LIST_MY_TICKETS", confidence: "HIGH", entities: {}, missingFields: [], extra: 1 } }), caseById("C3"));
    assert.equal(s.zodValid, false);
    assert.equal(s.intentCorrect, false);
    assert.equal(s.entitiesCorrect, false);
    assert.equal(s.toolCorrect, true);
    assert.deepEqual(s.reasons, ["SEM_INVALID_INTERPRETATION"]);
    assert.ok(s.stabilityKey.startsWith("unique:"));
  });

  it("tool inesperada no C6: tool incorreta e C6 sem a ação esperada", () => {
    const s = scoreTurn(record("C6", 1, { businessToolCalls: [{ tool: "searchArticles", args: { query: "parou tudo" }, rejected: false }] }), caseById("C6"));
    assert.equal(s.toolCorrect, false);
    assert.equal(s.c6Expected, false);
    assert.deepEqual(s.reasons, ["SEM_WRONG_TOOL"]);
  });

  it("chamada recusada pela validação conta como argumento errado", () => {
    const s = scoreTurn(record("C3", 1, { businessToolCalls: [{ tool: "listMyTickets", args: { userId: "EMP-A" }, rejected: true }] }), caseById("C3"));
    assert.equal(s.toolCorrect, false);
    assert.deepEqual(s.reasons, ["SEM_WRONG_TOOL_ARGS"]);
  });

  it("argumento proibido e termo semântico ausente reprovam a tool", () => {
    const forbidden = scoreTurn(record("C4", 1, {
      businessToolCalls: [{ tool: "proposeTicketDraft", args: { ...(PERFECT["C4"]?.calls[0]?.args as object), priority: "LOW" }, rejected: false }],
    }), caseById("C4"));
    assert.equal(forbidden.toolCorrect, false);
    const onlyMonitor = scoreTurn(record("C4", 1, {
      businessToolCalls: [{ tool: "proposeTicketDraft", args: { ...(PERFECT["C4"]?.calls[0]?.args as object), title: "Monitor" }, rejected: false }],
    }), caseById("C4"));
    assert.equal(onlyMonitor.toolCorrect, false, "só 'monitor' não basta");
  });

  it("tool sintética json do Groq não conta; outro nome desconhecido reprova", () => {
    const synthetic = scoreTurn(record("C6", 1, { syntheticToolCalls: [{ name: "json" }] }), caseById("C6"));
    assert.equal(synthetic.toolCorrect, true);
    const other = scoreTurn(record("C1", 1, { otherToolCalls: [{ name: "webSearch", args: {} }] }), caseById("C1"));
    assert.deepEqual(other.reasons, ["SEM_WRONG_TOOL"]);
  });

  it("missingFields exact recusa repetição; includes exige o obrigatório e recusa o proibido", () => {
    const dup = scoreTurn(record("C1", 1, { interpretationRaw: { intent: "ANSWER_KB", confidence: "HIGH", entities: {}, missingFields: ["TITLE", "TITLE"] } }), caseById("C1"));
    assert.deepEqual(dup.reasons, ["SEM_WRONG_MISSING_FIELDS"]);
    const c6 = scoreTurn(record("C6", 1, {
      interpretationRaw: { intent: "CREATE_TICKET", confidence: "LOW", entities: { impact: { workImpact: "BLOCKED" } }, missingFields: ["AFFECTED_SCOPE", "COMMITMENT_RISK"] },
    }), caseById("C6"));
    assert.deepEqual(c6.reasons, ["SEM_WRONG_MISSING_FIELDS"]);
  });

  it("EXEC_*: incorreto em todas as métricas e chave de estabilidade única", () => {
    const s = scoreTurn(record("C2", 2, { status: "execution_error", execError: { code: "EXEC_QUOTA", message: "cota diária esgotada" }, interpretationRaw: null, businessToolCalls: [] }), caseById("C2"));
    assert.deepEqual([s.zodValid, s.intentCorrect, s.toolCorrect, s.entitiesCorrect], [false, false, false, false]);
    assert.deepEqual(s.reasons, ["EXEC_QUOTA"]);
    assert.equal(s.stabilityKey, "unique:C2:2");
  });

  it("truncamento e efeito externo viram EXEC a partir do registro", () => {
    const truncated = scoreTurn(record("C1", 1, {
      contextCheck: { status: "DETECTED", budget: 7680, maxReportedInputTokens: 7700, estimatedInputTokens: 7000, overBudget: true, suspectedSilentTruncation: false, unverified: false },
    }), caseById("C1"));
    assert.deepEqual(truncated.reasons, ["EXEC_CONTEXT_TRUNCATED"]);
    assert.equal(truncated.contextTruncated, true);
    const external = scoreTurn(record("C1", 1, { externalRequests: ["https://exemplo.invalid/telemetria"] }), caseById("C1"));
    assert.deepEqual(external.reasons, ["EXEC_EXTERNAL_EFFECT"]);
  });

  it("vazamento de raciocínio: SEM_REASONING_LEAK; raciocínio em campo separado não é vazamento", () => {
    const leak = scoreTurn(record("C1", 1, { reasoning: { separatePresent: false, leakedInText: true, leakedInInterpretation: false } }), caseById("C1"));
    assert.equal(leak.reasoningLeak, true);
    assert.deepEqual(leak.reasons, ["SEM_REASONING_LEAK"]);
    const separate = scoreTurn(record("C1", 1, { reasoning: { separatePresent: true, leakedInText: false, leakedInInterpretation: false } }), caseById("C1"));
    assert.equal(separate.reasoningLeak, false);
  });
});

describe("aggregate", () => {
  it("18 perfeitos: aprovado em todos os limites", () => {
    const a = aggregate(cases, run18());
    assert.equal(a.approvedOnThresholds, true);
    assert.deepEqual([a.zodValid.count, a.intent.count, a.tool.count, a.entities.count, a.c6.count], [18, 18, 18, 18, 3]);
    assert.equal(a.stability.allSameCases, 6);
  });

  it("Zod: 2 inválidos (16 de 18) reprovam só o limite de Zod", () => {
    const invalid = { interpretationRaw: { intent: "ANSWER_KB" } };
    const a = aggregate(cases, run18((c, r) => (c === "C1" && r === 1) || (c === "C2" && r === 1) ? invalid : undefined));
    assert.equal(a.zodValid.count, 16);
    assert.equal(a.zodValid.pass, false);
    assert.equal(a.intent.pass, true);
    assert.equal(a.approvedOnThresholds, false);
  });

  it("intenção: 4 erradas em dois casos reprovam contagem e maioria", () => {
    const a = aggregate(cases, run18((c, r) => (c === "C1" || c === "C2") && r <= 2 ? wrongIntent(c) : undefined));
    assert.equal(a.intent.count, 14);
    assert.equal(a.intent.majorityCases, 4);
    assert.equal(a.intent.pass, false);
    assert.equal(a.tool.pass, true);
  });

  it("tool: 4 erradas reprovam o limite de tool", () => {
    const noCall = { businessToolCalls: [] };
    const a = aggregate(cases, run18((c, r) => (c === "C1" || c === "C3") && r <= 2 ? noCall : undefined));
    assert.equal(a.tool.count, 14);
    assert.equal(a.tool.pass, false);
  });

  it("entidades: 4 erradas reprovam o limite de entidades", () => {
    const badOs = { interpretationRaw: { intent: "ANSWER_KB", confidence: "HIGH", entities: { operatingSystem: "Windows 11" }, missingFields: [] } };
    const a = aggregate(cases, run18((c, r) => c === "C2" ? badOs : c === "C1" && r === 1 ? { interpretationRaw: { intent: "ANSWER_KB", confidence: "HIGH", entities: {}, missingFields: ["TITLE"] } } : undefined));
    assert.equal(a.entities.count, 14);
    assert.equal(a.entities.pass, false);
    assert.equal(a.intent.pass, true);
  });

  it("estabilidade: 3 casos com uma repetição divergente reprovam (3 de 6 com as 3 iguais)", () => {
    const a = aggregate(cases, run18((c, r) => ["C1", "C2", "C3"].includes(c) && r === 3 ? wrongIntent(c) : undefined));
    assert.equal(a.intent.pass, true, "15 de 18 e maioria em 6");
    assert.equal(a.stability.allSameCases, 3);
    assert.equal(a.stability.pass, false);
  });

  it("estabilidade: 3 concordantes, 2 de 3 e todas diferentes", () => {
    const c1Keys = ["CLARIFY", "OUT_OF_SCOPE", "ANSWER_KB"];
    const a = aggregate(cases, run18((c, r) => {
      if (c === "C1") {
        const interpretation = structuredClone(PERFECT["C1"]?.interpretation) as { intent: string };
        interpretation.intent = c1Keys[r - 1] ?? "ANSWER_KB";
        return { interpretationRaw: interpretation };
      }
      if (c === "C2" && r === 3) return wrongIntent("C2");
      return undefined;
    }));
    assert.equal(a.stability.concordanceByCase["C3"], 3);
    assert.equal(a.stability.concordanceByCase["C2"], 2);
    assert.equal(a.stability.concordanceByCase["C1"], 1);
    assert.equal(a.stability.allSameCases, 4);
    assert.equal(a.stability.othersMinConcordance, 1);
    assert.equal(a.stability.pass, false, "uma entrada sem 2 concordantes reprova");
  });

  it("C6: uma das 3 execuções com tool inesperada reprova o limite do 'Parou tudo!'", () => {
    const a = aggregate(cases, run18((c, r) => c === "C6" && r === 2 ? { businessToolCalls: [{ tool: "searchArticles", args: { query: "parou" }, rejected: false }] } : undefined));
    assert.equal(a.c6.count, 2);
    assert.equal(a.c6.pass, false);
    assert.equal(a.tool.pass, true);
  });

  it("tolerância zero: um vazamento de raciocínio reprova", () => {
    const a = aggregate(cases, run18((c, r) => c === "C5" && r === 1 ? { reasoning: { separatePresent: false, leakedInText: true, leakedInInterpretation: false } } : undefined));
    assert.equal(a.zeroTolerance.reasoningLeaks, 1);
    assert.equal(a.zeroTolerance.pass, false);
    assert.equal(a.approvedOnThresholds, false);
  });

  it("EXEC_* fica no denominador de 18", () => {
    const quota = { status: "execution_error" as const, execError: { code: "EXEC_QUOTA" as const, message: "cota" }, interpretationRaw: null, businessToolCalls: [] };
    const a = aggregate(cases, run18((c, r) => c === "C6" && r === 3 ? quota : undefined));
    assert.equal(a.denominator, 18);
    assert.equal(a.zodValid.count, 17);
    assert.equal(a.zodValid.pass, true);
    assert.equal(a.c6.pass, false);
  });

  it("recusa conjunto incompleto ou repetido", () => {
    const scores = run18();
    assert.throws(() => aggregate(cases, scores.slice(1)), /repetições 1, 2 e 3/);
    assert.throws(() => aggregate(cases, [...scores, scores[0] as TurnScore]), /repetido/);
  });
});

describe("aggregate: fronteiras dos limites", () => {
  const invalid = { interpretationRaw: { intent: "ANSWER_KB" } };
  const noCall = { businessToolCalls: [] };
  const badEntities: Record<string, Partial<TurnRecord>> = {
    C1: { interpretationRaw: { intent: "ANSWER_KB", confidence: "HIGH", entities: {}, missingFields: ["TITLE"] } },
    C2: { interpretationRaw: { intent: "ANSWER_KB", confidence: "HIGH", entities: { operatingSystem: "Windows 11" }, missingFields: [] } },
    C4: { interpretationRaw: { intent: "CREATE_TICKET", confidence: "HIGH", entities: { impact: { affectedScope: "TEAM" } }, missingFields: [] } },
  };

  it("Zod: 17 de 18 passa; 16 de 18 reprova", () => {
    const at17 = aggregate(cases, run18((c, r) => (c === "C1" && r === 1 ? invalid : undefined)));
    assert.deepEqual([at17.zodValid.count, at17.zodValid.pass], [17, true]);
    const at16 = aggregate(cases, run18((c, r) => (r === 1 && (c === "C1" || c === "C2") ? invalid : undefined)));
    assert.deepEqual([at16.zodValid.count, at16.zodValid.pass], [16, false]);
  });

  it("intenção: 15 de 18 com três erros em três casos passa; 14 de 18 reprova", () => {
    const at15 = aggregate(cases, run18((c, r) => (r === 1 && ["C1", "C2", "C3"].includes(c) ? wrongIntent(c) : undefined)));
    assert.deepEqual([at15.intent.count, at15.intent.majorityCases, at15.intent.pass], [15, 6, true]);
    const at14 = aggregate(cases, run18((c, r) => (r === 1 && ["C1", "C2", "C3", "C4"].includes(c) ? wrongIntent(c) : undefined)));
    assert.deepEqual([at14.intent.count, at14.intent.pass], [14, false]);
  });

  it("tool: 15 de 18 com três erros em três casos passa; 14 de 18 reprova", () => {
    const at15 = aggregate(cases, run18((c, r) => (r === 1 && ["C1", "C2", "C3"].includes(c) ? noCall : undefined)));
    assert.deepEqual([at15.tool.count, at15.tool.majorityCases, at15.tool.pass], [15, 6, true]);
    const at14 = aggregate(cases, run18((c, r) => (r === 1 && ["C1", "C2", "C3", "C4"].includes(c) ? noCall : undefined)));
    assert.deepEqual([at14.tool.count, at14.tool.pass], [14, false]);
  });

  it("entidades: 15 de 18 com três erros em três casos passa; 14 de 18 reprova", () => {
    const at15 = aggregate(cases, run18((c, r) => (r === 1 ? badEntities[c] : undefined)));
    assert.deepEqual([at15.entities.count, at15.entities.pass], [15, true]);
    const at14 = aggregate(cases, run18((c, r) => (r === 1 ? badEntities[c] : c === "C1" && r === 2 ? badEntities["C1"] : undefined)));
    assert.deepEqual([at14.entities.count, at14.entities.pass], [14, false]);
  });

  it("estabilidade: quatro entradas com 3 concordantes e duas com 2 passam; uma com 3 diferentes reprova", () => {
    const passes = aggregate(cases, run18((c, r) => (r === 3 && (c === "C1" || c === "C2") ? wrongIntent(c) : undefined)));
    assert.deepEqual([passes.stability.allSameCases, passes.stability.othersMinConcordance, passes.stability.pass], [4, 2, true]);
    const intents = ["CLARIFY", "OUT_OF_SCOPE", "ANSWER_KB"];
    const fails = aggregate(cases, run18((c, r) => {
      if (c !== "C1") return undefined;
      const interpretation = structuredClone(PERFECT["C1"]?.interpretation) as { intent: string };
      interpretation.intent = intents[r - 1] ?? "ANSWER_KB";
      return { interpretationRaw: interpretation };
    }));
    assert.deepEqual([fails.stability.concordanceByCase["C1"], fails.stability.pass], [1, false]);
  });
});

describe("aggregate: truncamento em três estados", () => {
  const check = (status: "NOT_DETECTED" | "DETECTED" | "UNKNOWN", over = false): Partial<TurnRecord> => ({
    contextCheck: {
      status,
      budget: 7680,
      maxReportedInputTokens: over ? 7700 : status === "UNKNOWN" ? null : 2000,
      estimatedInputTokens: 1900,
      overBudget: over,
      suspectedSilentTruncation: false,
      unverified: status === "UNKNOWN",
    },
  });

  it("18 em NOT_DETECTED: requisito aprovado", () => {
    const a = aggregate(cases, run18());
    assert.deepEqual(a.zeroTolerance.truncation, { notDetected: 18, detected: 0, unknown: 0, status: "pass" });
  });

  it("um UNKNOWN (ou indício heurístico): inconclusivo, e o agregado não aprova", () => {
    const a = aggregate(cases, run18((c, r) => (c === "C2" && r === 2 ? check("UNKNOWN") : undefined)));
    assert.equal(a.zeroTolerance.truncation.status, "inconclusive");
    assert.equal(a.zeroTolerance.pass, false);
    assert.equal(a.approvedOnThresholds, false);
    assert.equal(a.zodValid.count, 18, "UNKNOWN não reprova o turno, só deixa o requisito inconclusivo");
  });

  it("um DETECTED: reprova o requisito e o turno (EXEC_CONTEXT_TRUNCATED)", () => {
    const a = aggregate(cases, run18((c, r) => (c === "C2" && r === 2 ? check("DETECTED", true) : undefined)));
    assert.equal(a.zeroTolerance.truncation.status, "fail");
    assert.equal(a.zodValid.count, 17);
  });
});
