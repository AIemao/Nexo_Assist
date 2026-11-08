// Seed das fixtures (docs/evaluation/01-evaluation-scenarios.md §2.1, S1–S9).
// Só acessa o banco pela Unit of Work; a composição fica em cli.ts.
import { createCreateTicket } from "../application/create-ticket.js";
import { computeDueAt, type TicketStatus } from "../domain/index.js";
import type { UnitOfWork } from "../persistence/unit-of-work.js";
import { TICKET_FIXTURES, type FixtureLabel, type TicketFixture } from "./fixtures.js";

export interface SeedDependencies {
  unitOfWork: UnitOfWork;
  eventIdGenerator: { generate(): string };
}

const RESOLUTION_ORIGIN: TicketStatus = "WAITING_ANALYST";
const RESOLUTION_TARGET: TicketStatus = "RESOLVED";

// S4d: status que não é a origem nem o destino da transição.
export class SeedFixtureStateError extends Error {
  constructor(label: FixtureLabel, found: TicketStatus) {
    super(
      `Fixture ${label} em status inesperado: ${found} (esperado: ${RESOLUTION_ORIGIN} ou ${RESOLUTION_TARGET}).`,
    );
    this.name = "SeedFixtureStateError";
  }
}

function instantBefore(reference: Date, offsetMs: number): string {
  return new Date(reference.getTime() - offsetMs).toISOString();
}

export async function seedFixtures(
  deps: SeedDependencies,
  reference: Date,
): Promise<Record<FixtureLabel, string>> {
  const ids: Partial<Record<FixtureLabel, string>> = {};

  for (const fixture of TICKET_FIXTURES) {
    const ticketId = await createFixture(deps, fixture, reference);
    ids[fixture.label] = ticketId;

    if ("resolution" in fixture) {
      await resolveFixture(deps, fixture.label, ticketId, instantBefore(reference, fixture.resolution.beforeReferenceMs));
    }
  }

  if (!hasAllLabels(ids)) {
    throw new Error("Seed: mapa de fixtures incompleto.");
  }
  return ids;
}

// S1/S2: criação pelo caso de uso, com o relógio parado no instante de criação.
async function createFixture(deps: SeedDependencies, fixture: TicketFixture, reference: Date): Promise<string> {
  const createdAt = instantBefore(reference, fixture.createdBeforeReferenceMs);
  const createTicket = createCreateTicket({
    unitOfWork: deps.unitOfWork,
    eventIdGenerator: deps.eventIdGenerator,
    clock: { now: () => createdAt },
  });

  const result = await createTicket.execute({
    idempotencyKey: fixture.idempotencyKey,
    actor: { type: "EMPLOYEE", employeeId: fixture.requesterId },
    draft: { ...fixture.draft, firstResponseDueAt: computeDueAt(createdAt, fixture.draft.priority) },
  });

  if (!result.ok) {
    throw new Error(`Seed: criação de ${fixture.label} rejeitada com ${result.error}.`);
  }
  return result.ticket.id;
}

// S4: transição excepcional, numa Unit of Work própria por fixture.
async function resolveFixture(
  deps: SeedDependencies,
  label: FixtureLabel,
  ticketId: string,
  resolvedAt: string,
): Promise<void> {
  await deps.unitOfWork.execute(async ({ tickets, ticketEvents }) => {
    // TODO(Bloco 7): substituir esta transição pelo caso de uso de resolução.
    const current = await tickets.findById(ticketId);
    if (current === undefined) {
      throw new Error(`Seed: chamado ${ticketId} da fixture ${label} não encontrado.`);
    }

    // S4b: compara só o status, não as datas.
    if (current.status === RESOLUTION_TARGET) return;
    if (current.status !== RESOLUTION_ORIGIN) {
      throw new SeedFixtureStateError(label, current.status);
    }

    // S4c: altera só status, resolvedAt e updatedAt.
    const updated = await tickets.update({
      ...current,
      status: RESOLUTION_TARGET,
      resolvedAt,
      updatedAt: resolvedAt,
    });
    // S4e: lançar antes do evento faz a Unit of Work reverter; ok: false sozinho não reverte.
    if (!updated.ok) {
      throw new Error(`Seed: transição de ${label} recusada com ${updated.error}.`);
    }

    // S4c: changes e summary provisórios até o contrato de changes (DM §3.9).
    await ticketEvents.create({
      id: deps.eventIdGenerator.generate(),
      ticketId,
      type: "STATUS_CHANGED",
      actor: { type: "ANALYST", employeeId: "ANALYST-1" },
      summary: "Chamado resolvido",
      changes: [{ field: "status", previousValue: RESOLUTION_ORIGIN, newValue: RESOLUTION_TARGET }],
      occurredAt: resolvedAt,
    });
  });
}

function hasAllLabels(ids: Partial<Record<FixtureLabel, string>>): ids is Record<FixtureLabel, string> {
  return TICKET_FIXTURES.every((fixture) => ids[fixture.label] !== undefined);
}
