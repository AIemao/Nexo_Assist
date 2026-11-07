import type { TicketType } from "../domain/index.js";
import type { PrismaClient } from "../generated/prisma/client.js";

export interface TicketIdAllocator {
  allocateNext(type: TicketType): Promise<number>;
}

// DM §3.2. Um único upsert: cria a linha com 1 no primeiro uso ou incrementa.
export function createTicketIdAllocator(db: Pick<PrismaClient, "ticketCounter">): TicketIdAllocator {
  return {
    async allocateNext(type) {
      const counter = await db.ticketCounter.upsert({
        where: { type },
        create: { type, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      });
      return counter.lastNumber;
    },
  };
}
