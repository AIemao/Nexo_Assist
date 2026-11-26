import { Prisma, type Conversation as ConversationRow, type PrismaClient } from "../../generated/prisma/client";
import {
  isValidFlowStage,
  type CollectedData,
  type Conversation,
  type InteractionContext,
  type ResolutionSource,
} from "../../domain/conversation";
import { collectedDataSchema } from "./json-schemas";

// Conversa recusada antes de gravar: combinação de flow e stage fora do AF §3, regra de estrutura do
// DM §7.2 ou collectedData fora do contrato do DM §3.5.
export class InvalidConversationError extends Error {
  constructor(reason: string) {
    super(`conversa inválida: ${reason}`);
    this.name = "InvalidConversationError";
  }
}

// Encerrar uma conversa que não existe ou já está CLOSED (CLOSED é terminal, DM §7.1, invariante 15).
export class ConversationNotOpenError extends Error {
  constructor() {
    super("conversa inexistente ou já encerrada");
    this.name = "ConversationNotOpenError";
  }
}

// DM §3.5 e invariante 17. O repositório é o único que muda o status e sempre ajusta
// openOwnerEmployeeId na mesma escrita: ownerEmployeeId enquanto não CLOSED, null depois.
export interface ConversationRepository {
  findOpenByOwner(ownerEmployeeId: string): Promise<Conversation | undefined>;
  findById(id: string): Promise<Conversation | undefined>;
  // Lança P2002 do Prisma se o funcionário já tiver uma conversa não encerrada.
  create(conversation: Conversation): Promise<Conversation>;
  updateInteractionContext(id: string, context: InteractionContext, updatedAt: string): Promise<Conversation>;
  close(id: string, resolutionSource: ResolutionSource, closedAt: string): Promise<Conversation>;
}

export function createConversationRepository(db: Pick<PrismaClient, "conversation">): ConversationRepository {
  return {
    async findOpenByOwner(ownerEmployeeId) {
      const row = await db.conversation.findUnique({ where: { openOwnerEmployeeId: ownerEmployeeId } });
      return row === null ? undefined : toDomain(row);
    },

    async findById(id) {
      const row = await db.conversation.findUnique({ where: { id } });
      return row === null ? undefined : toDomain(row);
    },

    async create(conversation) {
      validateStructure(conversation);
      const row = await db.conversation.create({
        data: {
          id: conversation.id,
          ownerEmployeeId: conversation.ownerEmployeeId,
          status: conversation.status,
          assignedAnalystId: conversation.assignedAnalystId ?? null,
          ...contextColumns(conversation.interactionContext),
          resolutionSource: conversation.resolutionSource ?? null,
          createdAt: new Date(conversation.createdAt),
          updatedAt: new Date(conversation.updatedAt),
          openOwnerEmployeeId: conversation.status === "CLOSED" ? null : conversation.ownerEmployeeId,
        },
      });
      return toDomain(row);
    },

    async updateInteractionContext(id, context, updatedAt) {
      validateContext(context);
      const row = await db.conversation.update({
        where: { id },
        data: {
          ...contextColumns(context),
          // Contexto novo sem collectedData: a coluna volta a null (descarte, AF D11).
          ...(context.collectedData === undefined ? { collectedData: Prisma.DbNull } : {}),
          updatedAt: new Date(updatedAt),
        },
      });
      return toDomain(row);
    },

    async close(id, resolutionSource, closedAt) {
      const result = await db.conversation.updateMany({
        where: { id, status: { not: "CLOSED" } },
        data: {
          status: "CLOSED",
          openOwnerEmployeeId: null,
          // DM §3.5: assignedAnalystId é limpo ao sair de ANALYST_ACTIVE.
          assignedAnalystId: null,
          resolutionSource,
          updatedAt: new Date(closedAt),
        },
      });
      if (result.count === 0) throw new ConversationNotOpenError();
      const row = await db.conversation.findUniqueOrThrow({ where: { id } });
      return toDomain(row);
    },
  };
}

function validateContext(context: InteractionContext): void {
  if (!isValidFlowStage(context.flow, context.stage)) {
    throw new InvalidConversationError(`combinação de flow e stage fora do AF §3: ${context.flow}/${context.stage}`);
  }
  if (context.collectedData !== undefined && !collectedDataSchema.safeParse(context.collectedData).success) {
    throw new InvalidConversationError("collectedData fora do contrato do DM §3.5");
  }
}

// DM §7.2: assignedAnalystId só em ANALYST_ACTIVE; resolutionSource só em CLOSED.
function validateStructure(conversation: Conversation): void {
  validateContext(conversation.interactionContext);
  if (conversation.assignedAnalystId !== undefined && conversation.status !== "ANALYST_ACTIVE") {
    throw new InvalidConversationError("assignedAnalystId só existe em ANALYST_ACTIVE");
  }
  if (conversation.resolutionSource !== undefined && conversation.status !== "CLOSED") {
    throw new InvalidConversationError("resolutionSource só existe em CLOSED");
  }
}

function contextColumns(context: InteractionContext) {
  return {
    flow: context.flow,
    stage: context.stage,
    targetTicketId: context.targetTicketId ?? null,
    // Cópia JSON do valor validado (sem chaves undefined), no formato que o Prisma aceita.
    ...(context.collectedData === undefined ? {} : { collectedData: JSON.parse(JSON.stringify(context.collectedData)) }),
  };
}

function readCollectedData(value: unknown): CollectedData | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = collectedDataSchema.safeParse(value);
  if (!parsed.success) throw new InvalidConversationError("collectedData gravado fora do contrato do DM §3.5");
  return JSON.parse(JSON.stringify(parsed.data));
}

function toDomain(row: ConversationRow): Conversation {
  const collectedData = readCollectedData(row.collectedData);
  return {
    id: row.id,
    ownerEmployeeId: row.ownerEmployeeId,
    status: row.status,
    ...(row.assignedAnalystId === null ? {} : { assignedAnalystId: row.assignedAnalystId }),
    interactionContext: {
      flow: row.flow,
      stage: row.stage,
      ...(row.targetTicketId === null ? {} : { targetTicketId: row.targetTicketId }),
      ...(collectedData === undefined ? {} : { collectedData }),
    },
    ...(row.resolutionSource === null ? {} : { resolutionSource: row.resolutionSource }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
