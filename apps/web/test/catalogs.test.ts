import { describe, expect, it } from "vitest";
import {
  CONVERSATION_STATUSES,
  INTERACTION_FLOWS,
  INTERACTION_STAGES,
  MESSAGE_AUTHOR_TYPES,
  RESOLUTION_SOURCES,
  type ConversationStatus,
  type InteractionFlow,
  type InteractionStage,
  type MessageAuthorType,
  type ResolutionSource,
} from "../src/domain/conversation";
import {
  ConversationStatus as PrismaConversationStatusEnum,
  InteractionFlow as PrismaInteractionFlowEnum,
  InteractionStage as PrismaInteractionStageEnum,
  MessageAuthorType as PrismaMessageAuthorTypeEnum,
  ResolutionSource as PrismaResolutionSourceEnum,
} from "../src/generated/prisma/enums";
import type {
  ConversationStatus as PrismaConversationStatus,
  InteractionFlow as PrismaInteractionFlow,
  InteractionStage as PrismaInteractionStage,
  MessageAuthorType as PrismaMessageAuthorType,
  ResolutionSource as PrismaResolutionSource,
} from "../src/generated/prisma/enums";

// Igualdade estrita nos dois sentidos (padrão de apps/ticket-service/test/persistence/catalogs.test.ts).
// Os colchetes impedem a distribuição do conditional type sobre uniões.
type Equals<A, B> =
  [A] extends [B]
  ? [B] extends [A]
  ? true
  : false
  : false;

type Assert<T extends true> = T;

// Falha no typecheck se qualquer catálogo do web divergir do enum do Prisma.
export type CatalogTypeChecks = {
  conversationStatus: Assert<Equals<ConversationStatus, PrismaConversationStatus>>;
  interactionFlow: Assert<Equals<InteractionFlow, PrismaInteractionFlow>>;
  interactionStage: Assert<Equals<InteractionStage, PrismaInteractionStage>>;
  resolutionSource: Assert<Equals<ResolutionSource, PrismaResolutionSource>>;
  messageAuthorType: Assert<Equals<MessageAuthorType, PrismaMessageAuthorType>>;
};

const catalogs = [
  { name: "ConversationStatus", domain: CONVERSATION_STATUSES, prisma: Object.values(PrismaConversationStatusEnum) },
  { name: "InteractionFlow", domain: INTERACTION_FLOWS, prisma: Object.values(PrismaInteractionFlowEnum) },
  { name: "InteractionStage", domain: INTERACTION_STAGES, prisma: Object.values(PrismaInteractionStageEnum) },
  { name: "ResolutionSource", domain: RESOLUTION_SOURCES, prisma: Object.values(PrismaResolutionSourceEnum) },
  { name: "MessageAuthorType", domain: MESSAGE_AUTHOR_TYPES, prisma: Object.values(PrismaMessageAuthorTypeEnum) },
] as const;

describe("catálogos do web e enums do Prisma", () => {
  it.each(catalogs)("$name possui os mesmos valores, na mesma ordem, no domínio e no Prisma", ({ domain, prisma }) => {
    expect([...prisma]).toStrictEqual([...domain]);
  });
});
