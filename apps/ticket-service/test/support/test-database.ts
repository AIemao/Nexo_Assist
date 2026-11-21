import { randomUUID } from "node:crypto";
import { copyFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { inject } from "vitest";
import type { Employee } from "../../src/domain/index.js";
import { PrismaClient } from "../../src/generated/prisma/client.js";

// ADR-008, atualização de 2026-11-21: funcionários próprios dos testes, num catálogo fixo,
// gravados só quando o cenário pede. Nada cria funcionário a partir de um id recebido.
const TEST_EMPLOYEES = {
    "EMP-001": {
        id: "EMP-001",
        name: "Funcionário de Teste 1",
        email: "emp-001@teste.example",
        department: "Testes",
        role: "EMPLOYEE",
    },
    "EMP-002": {
        id: "EMP-002",
        name: "Funcionário de Teste 2",
        email: "emp-002@teste.example",
        department: "Testes",
        role: "EMPLOYEE",
    },
    "ANL-001": {
        id: "ANL-001",
        name: "Analista de Teste 1",
        email: "anl-001@teste.example",
        department: "Service Desk",
        role: "ANALYST",
    },
} as const satisfies Record<string, Employee>;

export type TestEmployeeId = keyof typeof TEST_EMPLOYEES;

export interface TestDatabase {
    prisma: PrismaClient;
    // Grava os funcionários pedidos do catálogo fixo; um id já gravado não é alterado.
    createEmployees(...ids: TestEmployeeId[]): Promise<void>;
    reset(): Promise<void>;
    dispose(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
    const template = inject("templateDatabasePath");
    const path = join(dirname(template), `${randomUUID()}.db`);
    copyFileSync(template, path);

    const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) });

    return {
        prisma,
        async createEmployees(...ids) {
            for (const id of ids) {
                const employee = TEST_EMPLOYEES[id];
                await prisma.employee.upsert({ where: { id }, create: employee, update: {} });
            }
        },
        // FKs com Restrict: os filhos de Ticket saem antes dele, e Employee sai por último.
        async reset() {
            await prisma.idempotencyRecord.deleteMany();
            await prisma.ticketEvent.deleteMany();
            await prisma.ticket.deleteMany();
            await prisma.ticketCounter.deleteMany();
            await prisma.employee.deleteMany();
        },
        async dispose() {
            await prisma.$disconnect();
            // No Windows o arquivo pode seguir travado logo após fechar a conexão.
            for (const file of [path, `${path}-journal`, `${path}-wal`, `${path}-shm`]) {
                rmSync(file, { force: true, maxRetries: 5, retryDelay: 100 });
            }
        },
    };
}
