import { normalizeEmail, type Employee } from "../domain/index.js";
import type { Employee as EmployeeRow, PrismaClient } from "../generated/prisma/client.js";

// DM §3.1; ADR-008, atualização de 2026-11-21: o e-mail é gravado já normalizado, com
// @unique, e a busca aplica a mesma normalização.
export interface EmployeeRepository {
  create(employee: Employee): Promise<Employee>;
  findById(id: string): Promise<Employee | undefined>;
  findByEmail(email: string): Promise<Employee | undefined>;
  // Plano da fatia 0, D2 (seed): cria só se o id estiver ausente; um funcionário já
  // existente é devolvido como está, sem comparar nem atualizar os dados.
  createIfAbsent(employee: Employee): Promise<Employee>;
}

export function createEmployeeRepository(db: Pick<PrismaClient, "employee">): EmployeeRepository {
  return {
    async create(employee) {
      const row = await db.employee.create({ data: toColumns(employee) });
      return toDomain(row);
    },

    async findById(id) {
      const row = await db.employee.findUnique({ where: { id } });
      return row === null ? undefined : toDomain(row);
    },

    async findByEmail(email) {
      const row = await db.employee.findUnique({ where: { email: normalizeEmail(email) } });
      return row === null ? undefined : toDomain(row);
    },

    async createIfAbsent(employee) {
      const row = await db.employee.upsert({
        where: { id: employee.id },
        create: toColumns(employee),
        update: {},
      });
      return toDomain(row);
    },
  };
}

function toColumns(employee: Employee) {
  return {
    id: employee.id,
    name: employee.name,
    email: normalizeEmail(employee.email),
    department: employee.department,
    role: employee.role,
  };
}

function toDomain(row: EmployeeRow): Employee {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    department: row.department,
    role: row.role,
  };
}
