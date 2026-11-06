import { validateTicketInvariants, type Ticket } from "../domain/index.js";
import {
  Prisma,
  type PrismaClient,
  type Ticket as TicketRow,
} from "../generated/prisma/client.js";
import { TicketInvariantViolation } from "./ticket-invariant-violation.js";

export type UpdateTicketResult =
  | { ok: true; ticket: Ticket }
  | { ok: false; error: "VERSION_CONFLICT" | "NOT_FOUND" };

export interface TicketRepository {
  create(ticket: Ticket): Promise<Ticket>;
  findById(id: string): Promise<Ticket | undefined>;
  update(ticket: Ticket): Promise<UpdateTicketResult>;
}

export function createTicketRepository(prisma: PrismaClient): TicketRepository {
  return {
    async create(ticket) {
      assertInvariants(ticket);
      const row = await prisma.ticket.create({
        data: { id: ticket.id, ...toColumns(ticket) },
      });
      return toDomain(row);
    },

    async findById(id) {
      const row = await prisma.ticket.findUnique({ where: { id } });
      return row === null ? undefined : toDomain(row);
    },

    // Concorrência otimista (README §9): a versão esperada entra no where.
    async update(ticket) {
      assertInvariants(ticket);
      try {
        const row = await prisma.ticket.update({
          where: { id: ticket.id, version: ticket.version },
          data: { ...toColumns(ticket), version: ticket.version + 1 },
        });
        return { ok: true, ticket: toDomain(row) };
      } catch (error) {
        if (!isRecordNotFound(error)) throw error;
        const existing = await prisma.ticket.findUnique({
          where: { id: ticket.id },
          select: { id: true },
        });
        return { ok: false, error: existing === null ? "NOT_FOUND" : "VERSION_CONFLICT" };
      }
    },
  };
}

function assertInvariants(ticket: Ticket): void {
  const result = validateTicketInvariants(ticket);
  if (!result.ok) throw new TicketInvariantViolation(result.errors);
}

function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

function toColumns(ticket: Ticket) {
  return {
    version: ticket.version,
    type: ticket.type,
    title: ticket.title,
    description: ticket.description,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    requesterId: ticket.requesterId,
    workImpact: ticket.impactAssessment.workImpact,
    affectedScope: ticket.impactAssessment.affectedScope,
    commitmentRisk: ticket.impactAssessment.commitmentRisk,
    assignedTo: ticket.assignedTo ?? null,
    createdAt: new Date(ticket.createdAt),
    updatedAt: new Date(ticket.updatedAt),
    resolvedAt: toOptionalDate(ticket.resolvedAt),
    firstResponseDueAt: new Date(ticket.firstResponseDueAt),
    nextUpdateDueAt: toOptionalDate(ticket.nextUpdateDueAt),
    serviceDeskUpdatedAt: toOptionalDate(ticket.serviceDeskUpdatedAt),
  };
}

function toOptionalDate(value: string | undefined): Date | null {
  return value === undefined ? null : new Date(value);
}

// null da linha vira chave ausente no Ticket, nunca undefined explícito.
function toDomain(row: TicketRow): Ticket {
  return {
    id: row.id,
    version: row.version,
    type: row.type,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    status: row.status,
    requesterId: row.requesterId,
    impactAssessment: {
      workImpact: row.workImpact,
      affectedScope: row.affectedScope,
      commitmentRisk: row.commitmentRisk,
    },
    ...(row.assignedTo === null ? {} : { assignedTo: row.assignedTo }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.resolvedAt === null ? {} : { resolvedAt: row.resolvedAt.toISOString() }),
    firstResponseDueAt: row.firstResponseDueAt.toISOString(),
    ...(row.nextUpdateDueAt === null ? {} : { nextUpdateDueAt: row.nextUpdateDueAt.toISOString() }),
    ...(row.serviceDeskUpdatedAt === null
      ? {}
      : { serviceDeskUpdatedAt: row.serviceDeskUpdatedAt.toISOString() }),
  };
}
