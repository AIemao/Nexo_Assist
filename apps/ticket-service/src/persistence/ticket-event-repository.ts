import type { Actor, TicketEvent } from "../domain/index.js";
import type { PrismaClient, TicketEvent as TicketEventRow } from "../generated/prisma/client.js";
import { CorruptedRecordError } from "./corrupted-record-error.js";
import { fromPrismaJson, toPrismaJson } from "./json.js";

export interface TicketEventRepository {
  create(event: TicketEvent): Promise<void>;
  listByTicket(ticketId: string): Promise<TicketEvent[]>;
}

export function createTicketEventRepository(
  db: Pick<PrismaClient, "ticketEvent">,
): TicketEventRepository {
  return {
    async create(event) {
      await db.ticketEvent.create({
        data: {
          id: event.id,
          ticketId: event.ticketId,
          type: event.type,
          actorType: event.actor.type,
          actorEmployeeId: event.actor.type === "SYSTEM" ? null : event.actor.employeeId,
          summary: event.summary,
          changes: toPrismaJson(event.changes),
          occurredAt: new Date(event.occurredAt),
        },
      });
    },

    async listByTicket(ticketId) {
      const rows = await db.ticketEvent.findMany({
        where: { ticketId },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      });
      return rows.map(toDomain);
    },
  };
}

function toDomain(row: TicketEventRow): TicketEvent {
  const changes = fromPrismaJson(row.changes);
  if (!Array.isArray(changes)) {
    throw new CorruptedRecordError("TicketEvent", row.id, "changes não é um array");
  }
  return {
    id: row.id,
    ticketId: row.ticketId,
    type: row.type,
    actor: toActor(row),
    summary: row.summary,
    changes,
    occurredAt: row.occurredAt.toISOString(),
  };
}

// DM §3.9: combinação inválida de actorType e actorEmployeeId é dado corrompido.
function toActor(row: TicketEventRow): Actor {
  const { actorType, actorEmployeeId } = row;
  if (actorType === "SYSTEM") {
    if (actorEmployeeId !== null) {
      throw new CorruptedRecordError("TicketEvent", row.id, "ator SYSTEM com actorEmployeeId");
    }
    return { type: "SYSTEM" };
  }
  if (actorEmployeeId === null) {
    throw new CorruptedRecordError("TicketEvent", row.id, `ator ${actorType} sem actorEmployeeId`);
  }
  return { type: actorType, employeeId: actorEmployeeId };
}
