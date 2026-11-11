import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { ARTICLES, SESSION_EMPLOYEE_ID, TICKETS, normalizeText } from "./fixtures.ts";
import { AFFECTED_SCOPES, COMMITMENT_RISKS, TICKET_CATEGORIES, TICKET_TYPES, WORK_IMPACTS } from "./schema.ts";

// Quatro tools FALSAS (README §6; ADR-001): respostas determinísticas tiradas das
// fixtures, nenhuma chamada de rede, nenhuma escrita real. Cada execução fica no registro
// da sessão, com os argumentos recebidos.
//
// O registro só vê execuções. Uma chamada com argumentos inválidos é recusada pela
// validação do Mastra antes do `execute`: ela aparece nos toolCalls da resposta do agent,
// não aqui, e conta como tool incorreta (CRITERIA.md).

export interface ToolCallRecord {
  tool: "searchArticles" | "listMyTickets" | "proposeTicketDraft" | "requestHandoff";
  args: unknown;
}

// Schemas de entrada das quatro tools de negócio. Exportados para que o validador dos casos
// confira os argumentos das chamadas gravadas no histórico (cases.json) com as mesmas regras.
export const TOOL_INPUT_SCHEMAS = {
  searchArticles: z.strictObject({
    query: z.string().min(1).describe("Palavras-chave da dúvida do funcionário."),
  }),
  // Sem parâmetro de identidade: o backend injeta o funcionário da sessão (README §8; ADR-004).
  listMyTickets: z.strictObject({}),
  // Sem prioridade nem prazo: vêm do ticket-service (DM §7.1, invariante 3; README §6).
  proposeTicketDraft: z.strictObject({
    title: z.string().min(1),
    description: z.string().min(1),
    type: z.enum(TICKET_TYPES),
    category: z.enum(TICKET_CATEGORIES),
    impactAssessment: z.strictObject({
      affectedScope: z.enum(AFFECTED_SCOPES),
      workImpact: z.enum(WORK_IMPACTS),
      commitmentRisk: z.enum(COMMITMENT_RISKS),
    }),
  }),
  requestHandoff: z.strictObject({
    reason: z.string().min(1).optional().describe("Motivo curto do pedido."),
  }),
};

// Uma fábrica por sessão: as 3 repetições de cada caso são independentes (CRITERIA.md).
export function createFakeTools() {
  const calls: ToolCallRecord[] = [];

  const searchArticles = createTool({
    id: "searchArticles",
    description:
      "Busca artigos da central de ajuda de TI por palavras-chave. Use para responder dúvidas que um artigo possa resolver.",
    inputSchema: TOOL_INPUT_SCHEMAS.searchArticles,
    execute: async (input) => {
      calls.push({ tool: "searchArticles", args: input });
      // Busca lexical (ADR-003): o artigo casa se alguma palavra-chave aparece na consulta normalizada.
      const query = normalizeText(input.query);
      return {
        articles: ARTICLES.filter((article) => article.keywords.some((keyword) => query.includes(keyword))).map(
          ({ id, title, content, applicability }) => ({ id, title, content, ...(applicability ? { applicability } : {}) }),
        ),
      };
    },
  });

  const listMyTickets = createTool({
    id: "listMyTickets",
    description: "Lista os chamados do funcionário autenticado. Não recebe identificação: a sessão já a define.",
    inputSchema: TOOL_INPUT_SCHEMAS.listMyTickets,
    execute: async (input) => {
      calls.push({ tool: "listMyTickets", args: input });
      return {
        tickets: TICKETS.filter((ticket) => ticket.requesterId === SESSION_EMPLOYEE_ID).map(
          ({ id, type, category, title, priority, status }) => ({ id, type, category, title, priority, status }),
        ),
      };
    },
  });

  // Proposta, não escrita (ADR-001): no sistema real grava uma PendingAction no web.
  const proposeTicketDraft = createTool({
    id: "proposeTicketDraft",
    description:
      "Propõe um rascunho de chamado para o funcionário confirmar. Só use quando todos os dados estiverem completos. Não informe prioridade nem prazo.",
    inputSchema: TOOL_INPUT_SCHEMAS.proposeTicketDraft,
    execute: async (input) => {
      calls.push({ tool: "proposeTicketDraft", args: input });
      return { pendingActionId: "PA-SPIKE-1", version: 1, status: "PENDING_CONFIRMATION" };
    },
  });

  // Só emite a intenção; quem transfere é o backend (README §6).
  const requestHandoff = createTool({
    id: "requestHandoff",
    description: "Pede a transferência da conversa para um analista humano.",
    inputSchema: TOOL_INPUT_SCHEMAS.requestHandoff,
    execute: async (input) => {
      calls.push({ tool: "requestHandoff", args: input });
      return { status: "HANDOFF_REQUESTED" };
    },
  });

  return { tools: { searchArticles, listMyTickets, proposeTicketDraft, requestHandoff }, calls };
}
