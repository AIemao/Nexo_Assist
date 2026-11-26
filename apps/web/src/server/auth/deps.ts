import { requireConfig } from "../config";
import { logError, type ErrorLogger } from "../observability/error-log";
import { getUnitOfWork } from "../persistence/database";
import type { UnitOfWork } from "../persistence/unit-of-work";
import { systemClock, uuidGenerator, type Clock, type IdGenerator } from "../runtime";
import { createTicketServiceClient, type TicketServiceClient } from "../ticket-service/client";

// Dependências das rotas de autenticação e do helper de sessão. As rotas usam as de produção; os
// testes injetam relógio, ids, ticket-service falso e banco descartável.
export interface AuthDeps {
  unitOfWork: UnitOfWork;
  ticketService: TicketServiceClient;
  clock: Clock;
  ids: IdGenerator;
  logError: ErrorLogger;
}

export function productionAuthDeps(): AuthDeps {
  return {
    unitOfWork: getUnitOfWork(),
    ticketService: createTicketServiceClient({ baseUrl: requireConfig().ticketServiceUrl }),
    clock: systemClock,
    ids: uuidGenerator,
    logError,
  };
}
