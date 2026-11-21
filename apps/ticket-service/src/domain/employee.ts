// DM §3.1. Catálogo como fonte única; o tipo é derivado (README §12 #18).
export const EMPLOYEE_ROLES = ["EMPLOYEE", "ANALYST"] as const;
export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

// DM §3.1: identidade demonstrativa e papel. A distinção N1/N2 não é modelada.
export interface Employee {
  id: string;
  name: string;
  email: string; // e-mail corporativo, usado no login; gravado já normalizado
  department: string;
  role: EmployeeRole;
}

// DM §3.1: o e-mail é único e comparado sem diferenciar maiúsculas de minúsculas e sem
// espaços nas pontas. A mesma normalização vale na gravação e na busca (ADR-008,
// atualização de 2026-11-21). Não valida o formato: string vazia continua vazia.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
