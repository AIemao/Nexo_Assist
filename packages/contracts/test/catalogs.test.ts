import { describe, expect, it } from "vitest";

import {
  AFFECTED_SCOPES,
  COMMITMENT_RISKS,
  MISSING_FIELDS,
  PRIORITIES,
  TICKET_CATEGORIES,
  TICKET_STATUSES,
  TICKET_TYPES,
  WORK_IMPACTS,
} from "../src/index.js";

import type {
  AffectedScope,
  CommitmentRisk,
  MissingField,
  Priority,
  TicketCategory,
  TicketStatus,
  TicketType,
  WorkImpact,
} from "../src/index.js";

// Referências de regressão escritas por extenso. Ficam só neste teste, nunca em código de
// produção. A ordem importa: é a ordem dos enums no JSON Schema que o modelo vê (ADR-009,
// nota de 2026-11-22, W8.1).

// Igualdade estrita nos dois sentidos (mesma convenção de
// apps/ticket-service/test/persistence/catalogs.test.ts).
// Os colchetes impedem a distribuição do conditional type sobre uniões.
type Equals<A, B> =
  [A] extends [B]
  ? [B] extends [A]
  ? true
  : false
  : false;

type Assert<T extends true> = T;

type ExpectedTicketType = "INC" | "REQ";
type ExpectedTicketCategory = "ACCESS" | "NETWORK_VPN" | "HARDWARE" | "SOFTWARE" | "EMAIL" | "OTHER";
type ExpectedPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
type ExpectedTicketStatus = "WAITING_ANALYST" | "APPROVED" | "RESOLVED";
type ExpectedAffectedScope = "SELF" | "TEAM" | "COMPANY" | "UNKNOWN";
type ExpectedWorkImpact = "BLOCKED" | "DEGRADED_WITH_WORKAROUND" | "NONE";
type ExpectedCommitmentRisk = "YES" | "NO" | "UNKNOWN" | "NOT_ASKED";
// A union que existia em apps/ticket-service/src/domain/catalogs.ts antes da migração.
type ExpectedMissingField =
  | "TITLE" | "DESCRIPTION" | "TYPE" | "CATEGORY" | "AFFECTED_SCOPE" | "WORK_IMPACT"
  | "COMMITMENT_RISK" | "TARGET_TICKET" | "ADDITIONAL_INFORMATION" | "REOPEN_REASON";

// Falha no typecheck se qualquer tipo divergir da referência.
export type CatalogTypeChecks = {
  ticketType: Assert<Equals<TicketType, ExpectedTicketType>>;
  ticketCategory: Assert<Equals<TicketCategory, ExpectedTicketCategory>>;
  priority: Assert<Equals<Priority, ExpectedPriority>>;
  ticketStatus: Assert<Equals<TicketStatus, ExpectedTicketStatus>>;
  affectedScope: Assert<Equals<AffectedScope, ExpectedAffectedScope>>;
  workImpact: Assert<Equals<WorkImpact, ExpectedWorkImpact>>;
  commitmentRisk: Assert<Equals<CommitmentRisk, ExpectedCommitmentRisk>>;
  missingField: Assert<Equals<MissingField, ExpectedMissingField>>;
};

// Valores e ordem em runtime.
const catalogs = [
  { name: "TICKET_TYPES", actual: TICKET_TYPES, expected: ["INC", "REQ"] },
  {
    name: "TICKET_CATEGORIES",
    actual: TICKET_CATEGORIES,
    expected: ["ACCESS", "NETWORK_VPN", "HARDWARE", "SOFTWARE", "EMAIL", "OTHER"],
  },
  { name: "PRIORITIES", actual: PRIORITIES, expected: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
  { name: "TICKET_STATUSES", actual: TICKET_STATUSES, expected: ["WAITING_ANALYST", "APPROVED", "RESOLVED"] },
  { name: "AFFECTED_SCOPES", actual: AFFECTED_SCOPES, expected: ["SELF", "TEAM", "COMPANY", "UNKNOWN"] },
  { name: "WORK_IMPACTS", actual: WORK_IMPACTS, expected: ["BLOCKED", "DEGRADED_WITH_WORKAROUND", "NONE"] },
  { name: "COMMITMENT_RISKS", actual: COMMITMENT_RISKS, expected: ["YES", "NO", "UNKNOWN", "NOT_ASKED"] },
  {
    name: "MISSING_FIELDS",
    actual: MISSING_FIELDS,
    expected: [
      "TITLE",
      "DESCRIPTION",
      "TYPE",
      "CATEGORY",
      "AFFECTED_SCOPE",
      "WORK_IMPACT",
      "COMMITMENT_RISK",
      "TARGET_TICKET",
      "ADDITIONAL_INFORMATION",
      "REOPEN_REASON",
    ],
  },
] as const;

describe("catálogos do @nexo/contracts", () => {
  it.each(catalogs)("$name tem os valores esperados, na ordem esperada", ({ actual, expected }) => {
    expect(actual).toStrictEqual(expected);
  });
});
