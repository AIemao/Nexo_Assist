import type { PrismaClient } from "../generated/prisma/client.js";
import { createTicketIdAllocator, type TicketIdAllocator } from "./ticket-id-allocator.js";
import { createTicketRepository, type TicketRepository } from "./ticket-repository.js";

export interface UnitOfWork {
  execute<T>(
    work: (repos: { tickets: TicketRepository; ticketIdAllocator: TicketIdAllocator }) => Promise<T>,
  ): Promise<T>;
}

export function createUnitOfWork(prisma: Pick<PrismaClient, "$transaction">): UnitOfWork {
  return {
    execute(work) {
      return prisma.$transaction(async (tx) =>
        work({ tickets: createTicketRepository(tx), ticketIdAllocator: createTicketIdAllocator(tx) }),
      );
    },
  };
}
