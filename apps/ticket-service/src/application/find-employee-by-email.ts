import type { Employee } from "../domain/index.js";
import type { UnitOfWork } from "../persistence/unit-of-work.js";

// Contrato §10: leitura do funcionário para o login simulado. A comparação do e-mail
// (DM §3.1: sem diferenciar maiúsculas e sem espaços nas pontas) é do repositório, que
// normaliza a entrada; como o e-mail é único, a busca encontra no máximo um funcionário.

export interface FindEmployeeByEmailInput {
  email: string;
}

export type FindEmployeeByEmailResult =
  | { ok: true; employee: Employee }
  | { ok: false; error: "EMPLOYEE_NOT_FOUND" };

export interface FindEmployeeByEmailDependencies {
  unitOfWork: UnitOfWork;
}

export function createFindEmployeeByEmail({ unitOfWork }: FindEmployeeByEmailDependencies) {
  return {
    async execute({ email }: FindEmployeeByEmailInput): Promise<FindEmployeeByEmailResult> {
      // ADR-008: leitura pela Unit of Work, em transação curta.
      const employee = await unitOfWork.execute(({ employees }) => employees.findByEmail(email));
      if (employee === undefined) return { ok: false, error: "EMPLOYEE_NOT_FOUND" };
      return { ok: true, employee };
    },
  };
}
