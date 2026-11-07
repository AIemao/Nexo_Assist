import {
  classifyPriority,
  computeDueAt,
  formatTicketId,
  validateImpactAssessment,
  type Actor,
  type CreateTicketDraft,
  type JsonValue,
  type Ticket,
  type TicketEvent,
} from "../domain/index.js";
import { CorruptedRecordError } from "../persistence/corrupted-record-error.js";
import { IdempotencyKeyAlreadyExists } from "../persistence/idempotency-key-already-exists.js";
import type { IdempotencyRecord } from "../persistence/idempotency-record-repository.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../persistence/unit-of-work.js";
import { toJsonValue } from "./to-json-value.js";

export type CreateTicketResult =
  | { ok: true; ticket: Ticket }
  | {
      ok: false;
      error:
        | "ACTOR_NOT_EMPLOYEE"
        | "INVALID_IMPACT_ASSESSMENT"
        | "PRIORITY_MISMATCH"
        | "IDEMPOTENCY_KEY_CONFLICT";
    };

export interface CreateTicketInput {
  idempotencyKey: string;
  draft: CreateTicketDraft;
  actor: Actor;
}

export interface CreateTicketDependencies {
  unitOfWork: UnitOfWork;
  eventIdGenerator: { generate(): string };
  clock: { now(): string };
}

export function createCreateTicket({ unitOfWork, eventIdGenerator, clock }: CreateTicketDependencies) {
  return {
    async execute({ idempotencyKey, draft, actor }: CreateTicketInput): Promise<CreateTicketResult> {
      // a. Ator antes de tudo (DM §8.5: a criação é solicitada pelo funcionário).
      if (actor.type !== "EMPLOYEE") return { ok: false, error: "ACTOR_NOT_EMPLOYEE" };
      const requesterId = actor.employeeId;

      // b. Chave existente: devolve o resultado original sem reavaliar (DM §3.16).
      const replay = await unitOfWork.execute((repos) => findReplay(repos, idempotencyKey, requesterId));
      if (replay !== undefined) return replay;

      // c. Revalidação da prévia (DM §3.3).
      if (!validateImpactAssessment(draft.impactAssessment).ok) {
        return { ok: false, error: "INVALID_IMPACT_ASSESSMENT" };
      }
      const classification = classifyPriority(draft.impactAssessment);
      if (classification.status === "NEEDS_CLARIFICATION") {
        // ImpactAssessment completo nunca chega aqui; se chegar, é bug.
        throw new Error(`classifyPriority pediu esclarecimento para avaliação completa: ${classification.reasonCode}`);
      }
      if (classification.priority !== draft.priority) return { ok: false, error: "PRIORITY_MISMATCH" };
      const priority = classification.priority;

      // d. Criação. e. O catch fica fora do execute: o rollback já aconteceu
      // quando a exceção chega aqui (DM §3.16, conflito recuperável).
      try {
        return await unitOfWork.execute(async (repos) => {
          const concurrent = await findReplay(repos, idempotencyKey, requesterId);
          if (concurrent !== undefined) return concurrent;

          const now = clock.now();
          const n = await repos.ticketIdAllocator.allocateNext(draft.type);
          const ticket = await repos.tickets.create({
            id: formatTicketId(draft.type, n),
            version: 1,
            type: draft.type,
            title: draft.title,
            description: draft.description,
            category: draft.category,
            priority,
            status: "WAITING_ANALYST",
            requesterId,
            impactAssessment: draft.impactAssessment,
            createdAt: now,
            updatedAt: now,
            firstResponseDueAt: computeDueAt(now, priority),
          });

          const event: TicketEvent = {
            id: eventIdGenerator.generate(),
            ticketId: ticket.id,
            type: "CREATED",
            actor,
            summary: "Chamado criado",
            changes: [],
            occurredAt: now,
          };
          await repos.ticketEvents.create(event);

          const result: CreateTicketResult = { ok: true, ticket };
          await repos.idempotencyRecords.create({
            key: idempotencyKey,
            operationType: "CREATE",
            ticketId: ticket.id,
            result: toJsonValue(result),
            createdAt: now,
          });
          return result;
        });
      } catch (error) {
        if (!(error instanceof IdempotencyKeyAlreadyExists)) throw error;
        const winner = await unitOfWork.execute((repos) => findReplay(repos, idempotencyKey, requesterId));
        if (winner === undefined) throw error;
        return winner;
      }
    },
  };
}

async function findReplay(
  repos: UnitOfWorkRepositories,
  idempotencyKey: string,
  requesterId: string,
): Promise<CreateTicketResult | undefined> {
  const record = await repos.idempotencyRecords.findByKey(idempotencyKey);
  if (record === undefined) return undefined;
  if (record.operationType !== "CREATE") return { ok: false, error: "IDEMPOTENCY_KEY_CONFLICT" };

  const ticket = await repos.tickets.findById(record.ticketId);
  if (ticket === undefined) {
    throw new CorruptedRecordError("IdempotencyRecord", record.key, "chamado do registro não encontrado");
  }
  if (ticket.requesterId !== requesterId) return { ok: false, error: "IDEMPOTENCY_KEY_CONFLICT" };

  return readSnapshot(record);
}

// DM §3.16: validação rasa; o restante do snapshot não é conferido contra o Ticket atual.
function readSnapshot(record: IdempotencyRecord): CreateTicketResult {
  const { result } = record;
  if (isJsonObject(result) && result["ok"] === true) {
    const ticket = result["ticket"];
    if (isJsonObject(ticket) && typeof ticket["id"] === "string" && ticket["id"] === record.ticketId) {
      // Único ponto com type assertion: o snapshot é histórico e só passou pela
      // validação rasa acima; tipá-lo como Ticket é uma promessa, não uma verificação.
      return { ok: true, ticket: ticket as unknown as Ticket };
    }
  }
  throw new CorruptedRecordError("IdempotencyRecord", record.key, "snapshot inválido");
}

function isJsonObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
