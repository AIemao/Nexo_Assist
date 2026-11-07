import type { JsonValue, TicketOperationType } from "../domain/index.js";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { IdempotencyKeyAlreadyExists } from "./idempotency-key-already-exists.js";
import { fromPrismaJson, toPrismaJson } from "./json.js";

// DM §3.16. Registro técnico do ticket-service, não entidade de domínio.
export interface IdempotencyRecord {
  key: string;
  operationType: TicketOperationType;
  ticketId: string;
  result: JsonValue;
  createdAt: string;
}

export interface IdempotencyRecordRepository {
  create(record: IdempotencyRecord): Promise<void>;
  findByKey(key: string): Promise<IdempotencyRecord | undefined>;
}

export function createIdempotencyRecordRepository(
  db: Pick<PrismaClient, "idempotencyRecord">,
): IdempotencyRecordRepository {
  return {
    async create(record) {
      try {
        await db.idempotencyRecord.create({
          data: {
            key: record.key,
            operationType: record.operationType,
            ticketId: record.ticketId,
            result: toPrismaJson(record.result),
            createdAt: new Date(record.createdAt),
          },
        });
      } catch (error) {
        if (isDuplicateKey(error)) throw new IdempotencyKeyAlreadyExists(record.key);
        throw error;
      }
    },

    async findByKey(key) {
      const row = await db.idempotencyRecord.findUnique({ where: { key } });
      if (row === null) return undefined;
      return {
        key: row.key,
        operationType: row.operationType,
        ticketId: row.ticketId,
        result: fromPrismaJson(row.result),
        createdAt: row.createdAt.toISOString(),
      };
    },
  };
}

// P2002 da chave. Reforço com o meta deste adapter (Prisma 7.10.1 + better-sqlite3):
// meta.modelName e meta.driverAdapterError.cause.constraint.fields; não há meta.target.
function isDuplicateKey(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const meta = error.meta;
  if (meta?.["modelName"] !== "IdempotencyRecord") return false;
  const fields = constraintFields(meta["driverAdapterError"]);
  return fields !== undefined && fields.length === 1 && fields[0] === "key";
}

function constraintFields(driverAdapterError: unknown): unknown[] | undefined {
  if (typeof driverAdapterError !== "object" || driverAdapterError === null) return undefined;
  if (!("cause" in driverAdapterError)) return undefined;
  const cause = driverAdapterError.cause;
  if (typeof cause !== "object" || cause === null || !("constraint" in cause)) return undefined;
  const constraint = cause.constraint;
  if (typeof constraint !== "object" || constraint === null || !("fields" in constraint)) {
    return undefined;
  }
  return Array.isArray(constraint.fields) ? constraint.fields : undefined;
}
