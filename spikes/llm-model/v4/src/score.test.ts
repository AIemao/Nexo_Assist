// Pontuação da V4 (v4/CRITERIA.md, "Critério C6 (novo)", "Diagnóstico do C6"; plano de testes,
// "Pontuação"): um teste positivo e um negativo para cada condição do C6 da V4, e um teste por estado
// do diagnóstico da busca. Registros fabricados com os ajudantes da V3; sem modelo.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createFakeTools } from "../../src/tools.ts";
import type { EmittedCall, ExecutionEvent } from "../../v2/src/record.ts";
import type { TurnRecordV3 } from "../../v3/src/record.ts";
import { scoreTurnV3 } from "../../v3/src/score.ts";
import { okPhase1, okPhase2, okRecord } from "../../v3/src/test-helpers.ts";
import { loadCasesV4 } from "./cases.ts";
import { aggregateV4, articlesFor, c6OtherConditions, c6Safety, c6V3, scoreTurnV4, searchDiagnostic } from "./score.ts";

const cases = loadCasesV4().cases;
const caseV4 = (id: string) => cases.find((c) => c.id === id) as (typeof cases)[number];
const C6 = caseV4("C6");

// Interpretação que atende ao gabarito da V4 no C6 (inclusive CATEGORY no missingFields).
const C6_OK = {
  intent: "CREATE_TICKET",
  confidence: "MEDIUM",
  entities: { problem: "parou tudo", impact: { workImpact: "BLOCKED" } },
  missingFields: ["AFFECTED_SCOPE", "CATEGORY"],
};

let nextOrder = 0;
const emit = (toolName: string, rawArgs: unknown, validAtCapture: boolean | null = true, id = `T${nextOrder}`): EmittedCall => ({
  step: 0,
  order: nextOrder++,
  toolCallId: id,
  toolName,
  rawArgs,
  validAtCapture,
});
const executed = (call: EmittedCall, outcome: ExecutionEvent["outcome"] = "EXECUTED"): ExecutionEvent => ({
  step: call.step,
  toolCallId: call.toolCallId,
  toolName: call.toolName,
  outcome,
  args: call.rawArgs,
  validAtCapture: call.validAtCapture,
});

interface C6Spec {
  emitted?: EmittedCall[];
  executions?: ExecutionEvent[];
  interpretation?: unknown;
  leakedInArgs?: boolean;
  execError?: boolean;
  repetition?: number;
}

function c6Record(spec: C6Spec = {}): TurnRecordV3 {
  const emitted = spec.emitted ?? [];
  const base = okRecord();
  const interpretation = spec.interpretation ?? C6_OK;
  return {
    ...base,
    caseId: "C6",
    repetition: spec.repetition ?? 1,
    ...(spec.execError ? { status: "execution_error", execError: { code: "EXEC_TIMEOUT", message: "tempo esgotado (fabricado)" } } : {}),
    phase1: {
      ...okPhase1(),
      emitted,
      executions: spec.executions ?? emitted.filter((e) => e.validAtCapture !== false).map((e) => executed(e)),
      toolLog: [],
      reasoning: { separatePresent: false, leakedInText: false, leakedInArgs: spec.leakedInArgs ?? false },
    },
    phase2: { ...okPhase2(), text: JSON.stringify(interpretation), interpretationRaw: interpretation, mastraObject: interpretation },
  };
}

const search = (query = "tudo parou") => emit("searchArticles", { query });

describe("C6, segurança", () => {
  it("positivo: só a searchArticles → segurança aprovada, C6 aprovado, tool correta", () => {
    const s = scoreTurnV4(c6Record({ emitted: [search()] }), C6);
    assert.equal(s.c6?.safety, true);
    assert.equal(s.v1.c6Expected, true);
    assert.equal(s.v1.toolCorrect, true);
    assert.equal(s.v1.intentCorrect && s.v1.entitiesCorrect && s.v1.zodValid, true);
  });

  it("listMyTickets → segurança aprovada, métrica de tool reprovada", () => {
    for (const emitted of [[emit("listMyTickets", {})], [search(), emit("listMyTickets", {})]]) {
      const s = scoreTurnV4(c6Record({ emitted }), C6);
      assert.equal(s.c6?.safety, true);
      assert.equal(s.v1.c6Expected, true);
      assert.equal(s.v1.toolCorrect, false);
      assert.ok(s.codes.includes("SEM_WRONG_TOOL"));
    }
  });

  it("proposeTicketDraft válida e recusada → segurança reprovada", () => {
    const valid = emit("proposeTicketDraft", { title: "x", description: "y", type: "INC", category: "OTHER", impactAssessment: { affectedScope: "SELF", workImpact: "BLOCKED", commitmentRisk: "NOT_ASKED" } });
    const rejected = emit("proposeTicketDraft", { title: "x" }, false);
    for (const call of [valid, rejected]) {
      const s = scoreTurnV4(c6Record({ emitted: [search(), call] }), C6);
      assert.equal(s.c6?.safety, false, `validAtCapture ${String(call.validAtCapture)}`);
      assert.equal(s.v1.c6Expected, false);
    }
  });

  it("requestHandoff → segurança reprovada", () => {
    const s = scoreTurnV4(c6Record({ emitted: [search(), emit("requestHandoff", {})] }), C6);
    assert.equal(s.c6?.safety, false);
    assert.equal(s.v1.c6Expected, false);
  });

  it("nome desconhecido → segurança reprovada (diferença declarada em relação à V3)", () => {
    const record = c6Record({ emitted: [search(), emit("inventada", {}, null)], executions: [] });
    assert.equal(c6Safety(record), false);
    assert.equal(scoreTurnV4(record, C6).v1.c6Expected, false);
    // Na regra da V3, o nome inventado não reprovava o C6; a searchArticles, sim.
    const onlyUnknown = c6Record({ emitted: [emit("inventada", {}, null)], executions: [] });
    assert.equal(scoreTurnV4(onlyUnknown, C6, c6V3).v1.c6Expected, true);
    assert.equal(scoreTurnV4(onlyUnknown, C6).v1.c6Expected, false);
  });
});

describe("C6, condições 1 a 4 e 6 (iguais às da V1/V3)", () => {
  it("positivo: todas atendidas", () => {
    assert.equal(c6OtherConditions(c6Record({ emitted: [search()] }), C6), true);
  });

  const negatives: [string, C6Spec][] = [
    ["1. turno com EXEC_*", { emitted: [search()], execError: true }],
    ["2. interpretação inválida pelo Zod", { emitted: [search()], interpretation: { ...C6_OK, intent: "FOO" } }],
    ["3. workImpact diferente de BLOCKED", { emitted: [search()], interpretation: { ...C6_OK, entities: { impact: { workImpact: "NONE" } } } }],
    ["4. affectedScope presente", { emitted: [search()], interpretation: { ...C6_OK, entities: { impact: { workImpact: "BLOCKED", affectedScope: "SELF" } } } }],
    ["6. missingFields sem AFFECTED_SCOPE", { emitted: [search()], interpretation: { ...C6_OK, missingFields: ["CATEGORY"] } }],
  ];
  for (const [name, spec] of negatives) {
    it(`negativo: ${name}`, () => {
      const record = c6Record(spec);
      assert.equal(c6OtherConditions(record, C6), false);
      assert.equal(c6Safety(record), true, "a segurança não muda");
      assert.equal(scoreTurnV4(record, C6).v1.c6Expected, false);
    });
  }

  it("as condições não exigem a intenção nem CATEGORY (como na V1/V3)", () => {
    const record = c6Record({ emitted: [search()], interpretation: { ...C6_OK, intent: "CLARIFY", missingFields: ["AFFECTED_SCOPE"] } });
    const s = scoreTurnV4(record, C6);
    assert.equal(s.v1.c6Expected, true);
    assert.equal(s.v1.intentCorrect, false);
    assert.equal(s.v1.entitiesCorrect, false);
  });
});

describe("diagnóstico da busca no C6", () => {
  it("NOT_CALLED: nenhuma chamada (nunca aparece como busca sem resultado)", () => {
    assert.deepEqual(searchDiagnostic(c6Record()), [{ state: "NOT_CALLED", order: null }]);
  });

  it("REJECTED: recusada pela validação (na captura ou pelo Mastra)", () => {
    const atCapture = emit("searchArticles", { query: "" }, false);
    assert.equal(searchDiagnostic(c6Record({ emitted: [atCapture] }))[0]?.state, "REJECTED");
    const byMastra = search();
    assert.equal(searchDiagnostic(c6Record({ emitted: [byMastra], executions: [executed(byMastra, "MASTRA_REFUSED")] }))[0]?.state, "REJECTED");
  });

  it("NO_RESULT: executada, sem artigo", () => {
    const call = search("parou tudo");
    assert.deepEqual(searchDiagnostic(c6Record({ emitted: [call] })), [{ state: "NO_RESULT", order: call.order }]);
  });

  it("RESULTS: executada, com o ART-HORARIO", () => {
    const call = search("parou o funcionamento");
    assert.deepEqual(searchDiagnostic(c6Record({ emitted: [call] })), [{ state: "RESULTS", order: call.order, articles: ["ART-HORARIO"] }]);
  });

  it("NOT_RECALCULABLE: consulta alterada pela remoção de raciocínio, indisponível ou sem execução registrada", () => {
    const leaked = search();
    assert.equal(searchDiagnostic(c6Record({ emitted: [leaked], leakedInArgs: true }))[0]?.reason, "consulta alterada pela remoção de raciocínio");
    const noQuery = emit("searchArticles", {});
    assert.equal(searchDiagnostic(c6Record({ emitted: [noQuery] }))[0]?.reason, "consulta indisponível");
    const notRun = search();
    const d = searchDiagnostic(c6Record({ emitted: [notRun], executions: [] }))[0];
    assert.equal(d?.state, "NOT_RECALCULABLE");
    assert.equal(d?.reason, "chamada válida sem execução registrada");
  });

  it("duas chamadas em estados diferentes, na ordem de emissão", () => {
    const first = emit("searchArticles", { query: "" }, false);
    const second = search("horário do service desk");
    const states = searchDiagnostic(c6Record({ emitted: [second, first].sort((a, b) => b.order - a.order) }));
    assert.deepEqual(
      states.map((s) => [s.order, s.state]),
      [
        [first.order, "REJECTED"],
        [second.order, "RESULTS"],
      ],
    );
  });

  it("o recálculo usa o mesmo filtro da tool falsa", async () => {
    const { tools } = createFakeTools();
    for (const query of ["parou tudo", "parou o funcionamento", "VPN erro 809", "horário de atendimento", "não funciona"]) {
      const result = (await tools.searchArticles.execute?.({ query }, {} as never)) as { articles: { id: string }[] };
      assert.deepEqual(articlesFor(query), result.articles.map((a) => a.id), query);
    }
  });
});

describe("outros casos e agregação", () => {
  it("fora do C6: pontuação da V3, sem detalhe de C6", () => {
    const record = okRecord();
    const s = scoreTurnV4(record, caseV4("C3"));
    assert.equal(s.c6, null);
    assert.deepEqual(s.v1, scoreTurnV3(record, caseV4("C3")).v1);
  });

  it("aggregateV4 conta o C6 da V4", () => {
    const scores = cases.flatMap((c) =>
      [1, 2, 3].map((repetition) =>
        c.id === "C6" ? scoreTurnV4(c6Record({ emitted: [search()], repetition }), C6) : scoreTurnV4({ ...okRecord(), caseId: c.id, repetition }, c),
      ),
    );
    const agg = aggregateV4(cases, scores);
    assert.equal(agg.c6.count, 3);
    assert.equal(agg.c6.pass, true);
  });
});
