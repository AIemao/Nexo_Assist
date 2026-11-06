
import { describe, expect, it } from "vitest";

import {
    ACTOR_TYPES,
    AFFECTED_SCOPES,
    COMMITMENT_RISKS,
    PRIORITIES,
    TICKET_CATEGORIES,
    TICKET_EVENT_TYPES,
    TICKET_OPERATION_TYPES,
    TICKET_STATUSES,
    TICKET_TYPES,
    WORK_IMPACTS,
} from "../../src/domain/index.js";

import type {
    ActorType,
    AffectedScope,
    CommitmentRisk,
    Priority,
    TicketCategory,
    TicketEventType,
    TicketOperationType,
    TicketStatus,
    TicketType,
    WorkImpact,
} from "../../src/domain/index.js";

import {
    ActorType as PrismaActorTypeEnum,
    AffectedScope as PrismaAffectedScopeEnum,
    CommitmentRisk as PrismaCommitmentRiskEnum,
    Priority as PrismaPriorityEnum,
    TicketCategory as PrismaTicketCategoryEnum,
    TicketEventType as PrismaTicketEventTypeEnum,
    TicketOperationType as PrismaTicketOperationTypeEnum,
    TicketStatus as PrismaTicketStatusEnum,
    TicketType as PrismaTicketTypeEnum,
    WorkImpact as PrismaWorkImpactEnum,
} from "../../src/generated/prisma/enums.js";

import type {
    ActorType as PrismaActorType,
    AffectedScope as PrismaAffectedScope,
    CommitmentRisk as PrismaCommitmentRisk,
    Priority as PrismaPriority,
    TicketCategory as PrismaTicketCategory,
    TicketEventType as PrismaTicketEventType,
    TicketOperationType as PrismaTicketOperationType,
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
    ticketEventTypes: Assert<Equals<TicketEventType, PrismaTicketEventType>>;
    actorTypes: Assert<Equals<ActorType, PrismaActorType>>;
    ticketOperationTypes: Assert<Equals<TicketOperationType, PrismaTicketOperationType>>;
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
    {
        name: "TicketEventType",
        domain: TICKET_EVENT_TYPES,
        prisma: Object.values(PrismaTicketEventTypeEnum),
    },
    {
        name: "ActorType",
        domain: ACTOR_TYPES,
        prisma: Object.values(PrismaActorTypeEnum),
    },
    {
        name: "TicketOperationType",
        domain: TICKET_OPERATION_TYPES,
        prisma: Object.values(PrismaTicketOperationTypeEnum),
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
