
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
} from "vitest";
import type { Ticket } from "../../src/domain/index.js";
import { IdempotencyKeyAlreadyExists } from "../../src/persistence/idempotency-key-already-exists.js";
import { createUnitOfWork } from "../../src/persistence/unit-of-work.js";
import { createTestDatabase } from "../support/test-database.js";

const chamadoValido: Ticket = {
    id: "INC-TEST-001",
    version: 1,
    type: "INC",
    title: "Notebook lento",
    description: "Notebook apresenta lentidão após atualização.",
    category: "HARDWARE",
    priority: "MEDIUM",
    status: "WAITING_ANALYST",
    requesterId: "EMP-001",
    impactAssessment: {
        workImpact: "NONE",
        affectedScope: "SELF",
        commitmentRisk: "NO",
    },
    createdAt: "2026-11-06T10:00:00.000Z",
    updatedAt: "2026-11-06T10:00:00.000Z",
    firstResponseDueAt: "2026-11-09T10:00:00.000Z",
};

function criarRegistro() {
    return {
        key: "OPERATION-TEST-001",
        operationType: "CREATE" as const,
        ticketId: chamadoValido.id,
        result: {
            ok: true,
            ticket: {
                id: chamadoValido.id,
                type: chamadoValido.type,
                title: chamadoValido.title,
                requesterId: chamadoValido.requesterId,
                impactAssessment: {
                    workImpact: "NONE",
                    affectedScope: "SELF",
                    commitmentRisk: "NO",
                },
                metadata: {
                    source: "createTicket",
                    tags: ["original", "confirmed"],
                },
            },
        },
        createdAt: "2026-11-07T12:34:56.789Z",
    };
}

describe("IdempotencyRecordRepository", () => {
    let db: Awaited<ReturnType<typeof createTestDatabase>>;
    let unitOfWork: ReturnType<typeof createUnitOfWork>;

    beforeAll(async () => {
        db = await createTestDatabase();
        unitOfWork = createUnitOfWork(db.prisma);
    });

    beforeEach(async () => {
        await db.reset();

        await unitOfWork.execute(async ({ tickets }) => {
            await tickets.create(chamadoValido);
        });
    });

    afterAll(async () => {
        await db.dispose();
    });

    it("persiste e recupera o registro com result aninhado e createdAt em Z", async () => {
        const registro = {
            ...criarRegistro(),
            createdAt: "2026-11-07T09:34:56.789-03:00",
        };

        await unitOfWork.execute(async ({ idempotencyRecords }) => {
            await idempotencyRecords.create(registro);
        });

        const registroPersistido = await unitOfWork.execute(
            async ({ idempotencyRecords }) => {
                return idempotencyRecords.findByKey(registro.key);
            },
        );

        expect(registroPersistido).toStrictEqual({
            ...registro,
            createdAt: "2026-11-07T12:34:56.789Z",
        });
    });

    it("retorna undefined quando a chave não existe", async () => {
        const registro = await unitOfWork.execute(
            async ({ idempotencyRecords }) => {
                return idempotencyRecords.findByKey("UNKNOWN-KEY");
            },
        );

        expect(registro).toBeUndefined();
    });

    it("lança IdempotencyKeyAlreadyExists para chave duplicada", async () => {
        const registroOriginal = criarRegistro();

        await unitOfWork.execute(async ({ idempotencyRecords }) => {
            await idempotencyRecords.create(registroOriginal);
        });

        const registroDuplicado = {
            ...registroOriginal,
            result: {
                ok: true,
                ticket: {
                    id: "INC-OTHER",
                    title: "Resultado que não deve substituir o original",
                },
            },
        };

        await expect(
            unitOfWork.execute(async ({ idempotencyRecords }) => {
                await idempotencyRecords.create(registroDuplicado);
            }),
        ).rejects.toBeInstanceOf(IdempotencyKeyAlreadyExists);

        const registroPersistido = await unitOfWork.execute(
            async ({ idempotencyRecords }) => {
                return idempotencyRecords.findByKey(registroOriginal.key);
            },
        );

        expect(registroPersistido).toStrictEqual(registroOriginal);
    });

    it("relança sem converter o erro que não é de chave duplicada", async () => {
        const registro = {
            ...criarRegistro(),
            ticketId: "INC-NONEXISTENT",
        };

        const erro = await unitOfWork
            .execute(async ({ idempotencyRecords }) => {
                await idempotencyRecords.create(registro);
            })
            .then(
                () => undefined,
                (falha: unknown) => falha,
            );

        expect(erro).not.toBeInstanceOf(IdempotencyKeyAlreadyExists);
        expect(erro).toMatchObject({ code: "P2003" });

        const registroPersistido = await unitOfWork.execute(
            async ({ idempotencyRecords }) => {
                return idempotencyRecords.findByKey(registro.key);
            },
        );

        expect(registroPersistido).toBeUndefined();
    });
});
