import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Employee } from "../../src/domain/index.js";
import { createUnitOfWork } from "../../src/persistence/unit-of-work.js";
import { createTestDatabase } from "../support/test-database.js";

// DM §3.1: e-mail único, comparado sem diferenciar maiúsculas de minúsculas e sem espaços nas
// pontas. ADR-008, atualização de 2026-11-21: gravado já normalizado, com @unique; a busca
// aplica a mesma normalização. createIfAbsent: plano da fatia 0, D2 (seed).

const ANA: Employee = {
    id: "EMP-A",
    name: "Ana Souza",
    email: "ana@nexo.example",
    department: "Operações",
    role: "EMPLOYEE",
};

describe("EmployeeRepository", () => {
    let db: Awaited<ReturnType<typeof createTestDatabase>>;
    let unitOfWork: ReturnType<typeof createUnitOfWork>;

    beforeAll(async () => {
        db = await createTestDatabase();
        unitOfWork = createUnitOfWork(db.prisma);
    });

    beforeEach(async () => {
        await db.reset();
    });

    afterAll(async () => {
        await db.dispose();
    });

    it("grava o e-mail normalizado", async () => {
        const criado = await unitOfWork.execute(({ employees }) =>
            employees.create({ ...ANA, email: " Ana@Nexo.EXAMPLE " }),
        );

        expect(criado).toStrictEqual(ANA);
        const linha = await db.prisma.employee.findUniqueOrThrow({ where: { id: "EMP-A" } });
        expect(linha.email).toBe("ana@nexo.example");
    });

    it("findByEmail encontra com maiúsculas e espaços nas pontas", async () => {
        await unitOfWork.execute(({ employees }) => employees.create(ANA));

        const encontrado = await unitOfWork.execute(({ employees }) => employees.findByEmail("  ANA@nexo.Example\t"));

        expect(encontrado).toStrictEqual(ANA);
    });

    it("findByEmail de e-mail inexistente devolve undefined", async () => {
        const encontrado = await unitOfWork.execute(({ employees }) => employees.findByEmail("ninguem@nexo.example"));

        expect(encontrado).toBeUndefined();
    });

    it("e-mail que só difere em maiúsculas é recusado pelo @unique (P2002)", async () => {
        await unitOfWork.execute(({ employees }) => employees.create(ANA));

        await expect(
            unitOfWork.execute(({ employees }) =>
                employees.create({ ...ANA, id: "EMP-A2", email: "ANA@NEXO.EXAMPLE" }),
            ),
        ).rejects.toMatchObject({ code: "P2002" });
        expect(await db.prisma.employee.count()).toBe(1);
    });

    it("findById devolve o funcionário ou undefined", async () => {
        await unitOfWork.execute(({ employees }) => employees.create(ANA));

        expect(await unitOfWork.execute(({ employees }) => employees.findById("EMP-A"))).toStrictEqual(ANA);
        expect(await unitOfWork.execute(({ employees }) => employees.findById("EMP-404"))).toBeUndefined();
    });

    it("createIfAbsent cria quando ausente e não altera um funcionário já existente (D2)", async () => {
        const criado = await unitOfWork.execute(({ employees }) => employees.createIfAbsent(ANA));
        expect(criado).toStrictEqual(ANA);

        const recuperado = await unitOfWork.execute(({ employees }) =>
            employees.createIfAbsent({ ...ANA, name: "Outro Nome", department: "Outro" }),
        );

        expect(recuperado).toStrictEqual(ANA);
        expect(await db.prisma.employee.count()).toBe(1);
    });
});
