import type { Message as MessageRow, PrismaClient } from "../../generated/prisma/client";
import type { Message, MessageAuthor } from "../../domain/conversation";
import { attachmentsSchema } from "./json-schemas";

export class InvalidMessageError extends Error {
  constructor(reason: string) {
    super(`mensagem inválida: ${reason}`);
    this.name = "InvalidMessageError";
  }
}

// DM §3.8. A ordem das mensagens na conversa é a de inserção (position, sequencial por conversa).
export interface MessageRepository {
  append(message: Message): Promise<Message>;
  listByConversation(conversationId: string): Promise<Message[]>;
}

export function createMessageRepository(db: Pick<PrismaClient, "message">): MessageRepository {
  return {
    async append(message) {
      const attachments = attachmentsSchema.safeParse(message.attachments);
      if (!attachments.success) throw new InvalidMessageError("attachments fora do contrato do DM §3.8");
      const last = await db.message.aggregate({ where: { conversationId: message.conversationId }, _max: { position: true } });
      const row = await db.message.create({
        data: {
          id: message.id,
          conversationId: message.conversationId,
          position: (last._max.position ?? 0) + 1,
          ...authorColumns(message.author),
          content: message.content,
          decisionRecordId: message.decisionRecordId ?? null,
          attachments: JSON.parse(JSON.stringify(attachments.data)),
          createdAt: new Date(message.createdAt),
        },
      });
      return toDomain(row);
    },

    async listByConversation(conversationId) {
      const rows = await db.message.findMany({ where: { conversationId }, orderBy: { position: "asc" } });
      return rows.map(toDomain);
    },
  };
}

function authorColumns(author: MessageAuthor) {
  switch (author.type) {
    case "EMPLOYEE":
    case "ANALYST":
      if (author.employeeId === "") throw new InvalidMessageError(`autor ${author.type} sem employeeId`);
      return { authorType: author.type, authorEmployeeId: author.employeeId };
    case "AGENT":
    case "SYSTEM":
      return { authorType: author.type, authorEmployeeId: null };
  }
}

function readAuthor(row: MessageRow): MessageAuthor {
  switch (row.authorType) {
    case "EMPLOYEE":
    case "ANALYST":
      if (row.authorEmployeeId === null) throw new InvalidMessageError(`autor ${row.authorType} gravado sem employeeId`);
      return { type: row.authorType, employeeId: row.authorEmployeeId };
    case "AGENT":
    case "SYSTEM":
      if (row.authorEmployeeId !== null) throw new InvalidMessageError(`autor ${row.authorType} gravado com employeeId`);
      return { type: row.authorType };
  }
}

function toDomain(row: MessageRow): Message {
  const attachments = attachmentsSchema.safeParse(row.attachments);
  if (!attachments.success) throw new InvalidMessageError("attachments gravados fora do contrato do DM §3.8");
  return {
    id: row.id,
    conversationId: row.conversationId,
    author: readAuthor(row),
    content: row.content,
    ...(row.decisionRecordId === null ? {} : { decisionRecordId: row.decisionRecordId }),
    attachments: attachments.data,
    createdAt: row.createdAt.toISOString(),
  };
}
