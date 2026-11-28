// Tool viewMyTicket (desvio D-1 da W8.3; plano PW-8; levantamento A5): extensão fora da linha de base
// da V4. Descrição e schema de entrada copiados do A5, sem alteração; estrutura dos resultados.
// Arquivo com SHA-256 fixado (manifest.json): qualquer mudança é versão nova do contrato do agent.
import { z } from "zod";

export const VIEW_MY_TICKET_NAME = "viewMyTicket";

export const VIEW_MY_TICKET_DESCRIPTION =
  "Consulta um chamado específico do funcionário autenticado. Use quando o chamado já está identificado pelo número. Não recebe identificação do funcionário: a sessão já a define.";

export const viewMyTicketInputSchema = z.strictObject({
  ticketId: z.string().min(1).describe("Número do chamado informado pelo funcionário."),
});

// Resultado de sucesso: os campos do chamado que o modelo vê, nesta ordem. resolvedAt só existe com
// status RESOLVED; isOverdue é true, false ou null (RESOLVED).
export const VIEW_MY_TICKET_TICKET_FIELDS = [
  "id",
  "type",
  "title",
  "description",
  "category",
  "priority",
  "status",
  "createdAt",
  "updatedAt",
  "resolvedAt",
  "currentDueAt",
  "isOverdue",
] as const;

// Negação: constante, sem eco do id, igual para chamado inexistente, alheio e malformado.
export const VIEW_MY_TICKET_NOT_FOUND = Object.freeze({ found: false } as const);
