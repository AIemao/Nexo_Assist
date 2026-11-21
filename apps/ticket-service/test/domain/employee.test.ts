import { describe, expect, it } from "vitest";

import { EMPLOYEE_ROLES, normalizeEmail } from "../../src/domain/index.js";
import type { Employee, EmployeeRole } from "../../src/domain/index.js";

// DM §3.1: Employee e EmployeeRole. E-mail único, comparado sem diferenciar maiúsculas de
// minúsculas e sem espaços nas pontas; gravado já normalizado (ADR-008, atualização de
// 2026-11-21).

// Igualdade estrita nos dois sentidos (mesma técnica de test/persistence/catalogs.test.ts).
type Equals<A, B> =
    [A] extends [B]
    ? [B] extends [A]
    ? true
    : false
    : false;

type Assert<T extends true> = T;

// Falha no typecheck se o tipo derivado ou o contrato do DM §3.1 divergirem.
export type EmployeeTypeChecks = {
    roleDerivedFromCatalog: Assert<Equals<EmployeeRole, (typeof EMPLOYEE_ROLES)[number]>>;
    roleValues: Assert<Equals<EmployeeRole, "EMPLOYEE" | "ANALYST">>;
    employeeRole: Assert<Equals<Employee["role"], EmployeeRole>>;
    employeeFields: Assert<Equals<keyof Employee, "id" | "name" | "email" | "department" | "role">>;
};

describe("EMPLOYEE_ROLES", () => {
    it("contém os papéis do DM §3.1, na ordem do contrato", () => {
        expect(EMPLOYEE_ROLES).toStrictEqual(["EMPLOYEE", "ANALYST"]);
    });
});

describe("normalizeEmail", () => {
    it.each([
        ["maiúsculas e espaços nas pontas", " Ana@Nexo.example ", "ana@nexo.example"],
        ["tabulação e quebra de linha nas pontas", "\tBRUNO@nexo.example\n", "bruno@nexo.example"],
        ["já normalizado", "carla@nexo.example", "carla@nexo.example"],
        ["string vazia continua vazia", "", ""],
        ["só espaços vira vazia", "   ", ""],
    ])("%s", (_nome, entrada, esperado) => {
        expect(normalizeEmail(entrada)).toBe(esperado);
    });

    it("não altera espaços internos", () => {
        expect(normalizeEmail(" Ana Souza@Nexo.example ")).toBe("ana souza@nexo.example");
    });
});
