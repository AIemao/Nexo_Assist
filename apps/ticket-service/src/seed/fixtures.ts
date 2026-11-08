// Fixtures dos cenários de avaliação (docs/evaluation/01-evaluation-scenarios.md,
// §2 "Dados de criação dos chamados" e §2.1, S1–S9). Todas são [Premissa].
import type { CreateTicketDraft } from "../domain/index.js";

export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;

// A prévia do prazo (firstResponseDueAt) é calculada pelo seed no instante de criação.
type FixtureDraft = Omit<CreateTicketDraft, "firstResponseDueAt">;

interface TicketFixtureDefinition {
  label: string;
  // S2: chave fixa por fixture. Mudar o conteúdo da fixture exige chave nova.
  idempotencyKey: string;
  // S8: o employeeId é o próprio rótulo do funcionário.
  requesterId: string;
  // S1: instante de criação = referência − createdBeforeReferenceMs.
  createdBeforeReferenceMs: number;
  // S4: transição para RESOLVED, posterior à criação.
  resolution?: { beforeReferenceMs: number };
  // A prioridade é escrita de propósito: o createTicket a confere (PRIORITY_MISMATCH).
  draft: FixtureDraft;
}

export const TICKET_FIXTURES = [
  {
    label: "TKT-A1",
    idempotencyKey: "fbf4ca97-3374-415d-8a02-44b8f7a32210",
    requesterId: "EMP-A",
    createdBeforeReferenceMs: 20 * MINUTE_MS,
    draft: {
      operation: "CREATE_TICKET",
      type: "INC",
      category: "HARDWARE",
      title: "Notebook lento",
      description: "O notebook está lento para abrir programas desde a última atualização.",
      impactAssessment: {
        workImpact: "DEGRADED_WITH_WORKAROUND",
        affectedScope: "SELF",
        commitmentRisk: "NO",
      },
      priority: "MEDIUM",
    },
  },
  {
    label: "TKT-A2",
    idempotencyKey: "fce06b00-b7b0-4180-b091-456a6df007d9",
    requesterId: "EMP-A",
    createdBeforeReferenceMs: 6 * DAY_MS,
    resolution: { beforeReferenceMs: 4 * DAY_MS },
    draft: {
      operation: "CREATE_TICKET",
      type: "INC",
      category: "ACCESS",
      title: "Senha do SAP não funciona",
      description: "A senha do SAP é recusada no login.",
      impactAssessment: {
        workImpact: "DEGRADED_WITH_WORKAROUND",
        affectedScope: "SELF",
        commitmentRisk: "NO",
      },
      priority: "MEDIUM",
    },
  },
  {
    label: "TKT-B1",
    idempotencyKey: "c72b557d-98ba-4bd0-9869-65af6a25f312",
    requesterId: "EMP-B",
    createdBeforeReferenceMs: 10 * MINUTE_MS,
    draft: {
      operation: "CREATE_TICKET",
      type: "INC",
      category: "HARDWARE",
      title: "Tecla solta no teclado reserva",
      description: "Uma tecla do teclado reserva está solta; uso o teclado principal normalmente.",
      impactAssessment: {
        workImpact: "NONE",
        affectedScope: "SELF",
        commitmentRisk: "NO",
      },
      priority: "LOW",
    },
  },
] as const satisfies readonly TicketFixtureDefinition[];

export type TicketFixture = (typeof TICKET_FIXTURES)[number];
export type FixtureLabel = TicketFixture["label"];
