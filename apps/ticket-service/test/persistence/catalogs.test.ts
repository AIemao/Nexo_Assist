
import { describe, expect, it } from "vitest";

import {
    AFFECTED_SCOPES,
    COMMITMENT_RISKS,
    PRIORITIES,
    TICKET_CATEGORIES,
    TICKET_STATUSES,
    TICKET_TYPES,
    WORK_IMPACTS,
} from "../../src/domain/index.js";

import type {
    AffectedScope,
    CommitmentRisk,
    Priority,
    TicketCategory,
    TicketStatus,
    TicketType,
    WorkImpact,
} from "../../src/domain/index.js";

import {
    AffectedScope as PrismaAffectedScopeEnum,
    CommitmentRisk as PrismaCommitmentRiskEnum,
    Priority as PrismaPriorityEnum,
    TicketCategory as PrismaTicketCategoryEnum,
    TicketStatus as PrismaTicketStatusEnum,
    TicketType as PrismaTicketTypeEnum,
    WorkImpact as PrismaWorkImpactEnum,
} from "../../src/generated/prisma/enums.js";

import type {
    AffectedScope as PrismaAffectedScope,
    CommitmentRisk as PrismaCommitmentRisk,
    Priority as PrismaPriority,
    TicketCategory as PrismaTicketCategory,
    TicketStatus as PrismaTicketStatus,
    TicketType as PrismaTicketType,
    WorkImpact as PrismaWorkImpact,
} from "../../src/generated/prisma/enums.js";

// Igualdade estrita nos dois sentidos.
// Os colchetes impedem a distribuição do conditional type sobre uniões.
type Equals<A, B> =
    [A] extends [B]
    ? [B] extends [A]
    ? true
    : false
    : false;

type Assert<T extends true> = T;

// Falha no typecheck se qualquer catálogo divergir.
export type CatalogTypeChecks = {
    ticketTypes: Assert<Equals<TicketType, PrismaTicketType>>;
    ticketCategories: Assert<Equals<TicketCategory, PrismaTicketCategory>>;
    priorities: Assert<Equals<Priority, PrismaPriority>>;
    ticketStatuses: Assert<Equals<TicketStatus, PrismaTicketStatus>>;
    workImpacts: Assert<Equals<WorkImpact, PrismaWorkImpact>>;
    affectedScopes: Assert<Equals<AffectedScope, PrismaAffectedScope>>;
    commitmentRisks: Assert<Equals<CommitmentRisk, PrismaCommitmentRisk>>;
};

// Verificação real de valores em runtime.
// O typecheck e o Vitest protegem contra problemas diferentes.
const catalogs = [
    {
        name: "TicketType",
        domain: TICKET_TYPES,
        prisma: Object.values(PrismaTicketTypeEnum),
    },
    {
        name: "TicketCategory",
        domain: TICKET_CATEGORIES,
        prisma: Object.values(PrismaTicketCategoryEnum),
    },
    {
        name: "Priority",
        domain: PRIORITIES,
        prisma: Object.values(PrismaPriorityEnum),
    },
    {
        name: "TicketStatus",
        domain: TICKET_STATUSES,
        prisma: Object.values(PrismaTicketStatusEnum),
    },
    {
        name: "WorkImpact",
        domain: WORK_IMPACTS,
        prisma: Object.values(PrismaWorkImpactEnum),
    },
    {
        name: "AffectedScope",
        domain: AFFECTED_SCOPES,
        prisma: Object.values(PrismaAffectedScopeEnum),
    },
    {
        name: "CommitmentRisk",
        domain: COMMITMENT_RISKS,
        prisma: Object.values(PrismaCommitmentRiskEnum),
    },
] as const;

describe("catálogos do domínio e enums do Prisma", () => {
    it.each(catalogs)(
        "$name possui os mesmos valores no domínio e no Prisma",
        ({ domain, prisma }) => {
            expect([...prisma].sort()).toEqual([...domain].sort());
        },
    );
});
