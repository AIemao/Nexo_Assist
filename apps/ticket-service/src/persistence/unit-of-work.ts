import type { PrismaClient } from "../generated/prisma/client.js";
import {
  createIdempotencyRecordRepository,
  type IdempotencyRecordRepository,
} from "./idempotency-record-repository.js";
import { createTicketEventRepository, type TicketEventRepository } from "./ticket-event-repository.js";
import { createTicketIdAllocator, type TicketIdAllocator } from "./ticket-id-allocator.js";
import { createTicketRepository, type TicketRepository } from "./ticket-repository.js";

export interface UnitOfWorkRepositories {
  tickets: TicketRepository;
  ticketIdAllocator: TicketIdAllocator;
  ticketEvents: TicketEventRepository;
  idempotencyRecords: IdempotencyRecordRepository;
}

export interface UnitOfWork {
  execute<T>(work: (repos: UnitOfWorkRepositories) => Promise<T>): Promise<T>;
}

export function createUnitOfWork(prisma: Pick<PrismaClient, "$transaction">): UnitOfWork {
  return {
    execute(work) {
      return prisma.$transaction(async (tx) =>
        work({
          tickets: createTicketRepository(tx),
          ticketIdAllocator: createTicketIdAllocator(tx),
          ticketEvents: createTicketEventRepository(tx),
          idempotencyRecords: createIdempotencyRecordRepository(tx),
        }),
      );
    },
  };
}
