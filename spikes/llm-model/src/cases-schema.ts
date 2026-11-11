import { z } from "zod";

// Formato dos gabaritos de cases.json (CRITERIA.md, "Gabaritos").

export const TOOL_NAMES = ["searchArticles", "listMyTickets", "proposeTicketDraft", "requestHandoff"] as const;

// Regras de valor:
// - "equals": o valor tem de ser um dos `values`, exatamente (catálogos: sem variação de caixa).
// - "normalized-contains-any": texto livre; depois de `normalizeText` (sem acentos,
//   minúsculas, só letras e algarismos), contém pelo menos um dos `values` (já normalizados).
// - "any": qualquer valor aceito pelo schema do campo.
const valueRule = z.discriminatedUnion("match", [
  z.strictObject({ match: z.literal("equals"), values: z.array(z.string().min(1)).min(1) }),
  z.strictObject({ match: z.literal("normalized-contains-any"), values: z.array(z.string().min(1)).min(1) }),
  z.strictObject({ match: z.literal("any") }),
]);

// Presença:
// - "required": o campo tem de existir e obedecer à regra;
// - "optional": pode faltar; se existir, obedece à regra;
// - "absent": não pode existir (sem regra).
const fieldRule = z.discriminatedUnion("presence", [
  z.strictObject({ path: z.string().min(1), presence: z.literal("required"), rule: valueRule }),
  z.strictObject({ path: z.string().min(1), presence: z.literal("optional"), rule: valueRule }),
  z.strictObject({ path: z.string().min(1), presence: z.literal("absent") }),
]);

const missingFieldsRule = z.discriminatedUnion("mode", [
  // A lista tem de ser exatamente esta, em qualquer ordem, sem repetição.
  z.strictObject({ mode: z.literal("exact"), values: z.array(z.string()) }),
  // Tem de conter todos os `required` e nenhum dos `forbidden`; os demais são aceitos.
  z.strictObject({ mode: z.literal("includes"), required: z.array(z.string()).min(1), forbidden: z.array(z.string()) }),
]);

const justification = z.strictObject({ claim: z.string().min(1), source: z.string().min(1) });

// Histórico gravado (CRITERIA.md, "Histórico gravado"): turnos anteriores fixos, idênticos em
// todas as repetições e modelos. Só o turno seguinte (`input`) é avaliado. Chamadas de tool no
// histórico usam as tools de negócio, com argumentos válidos pelo schema da tool e o resultado
// que a tool falsa devolveria.
const historyToolCall = z.strictObject({
  tool: z.enum(TOOL_NAMES),
  args: z.record(z.string(), z.unknown()),
  result: z.unknown(),
});

const historyTurn = z.discriminatedUnion("role", [
  z.strictObject({ role: z.literal("user"), content: z.string().min(1) }),
  z.strictObject({ role: z.literal("assistant"), content: z.string().min(1), toolCalls: z.array(historyToolCall).optional() }),
]);

// Estado da conversa que o histórico representa, no momento do turno avaliado. Documenta o
// histórico e é conferido contra ele pelo check-cases; NÃO é enviado ao modelo, que só vê as
// mensagens. Catálogos: DM §8.1 (estado da conversa), DM §3.13 (tipo e estado da PendingAction).
const conversationState = z.strictObject({
  conversationStatus: z.enum(["AI_ACTIVE", "WAITING_ANALYST", "ANALYST_ACTIVE", "CLOSED"]),
  pendingAction: z
    .strictObject({
      type: z.enum(["CREATE_TICKET", "UPDATE_TICKET", "REOPEN_TICKET"]),
      id: z.string().min(1),
      version: z.number().int().min(1),
      status: z.enum(["PENDING_CONFIRMATION", "CONFIRMED", "REJECTED", "CANCELLED"]),
    })
    .nullable(),
  // Chamado em foco (DM §3.5); null = nenhum.
  focusTicketId: z.string().min(1).nullable(),
});

// "faithful": reproduz o cenário (a frase pode ter sido redigida a partir da descrição da entrada).
// "derived": difere do cenário; `differences` diz em quê.
const derivation = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("faithful"), notes: z.array(z.string().min(1)) }),
  z.strictObject({ kind: z.literal("derived"), differences: z.array(z.string().min(1)).min(1) }),
]);

const caseSchema = z
  .strictObject({
    id: z.string().regex(/^C[1-6]$/),
    scenario: z.string().regex(/^SC-\d{2}$/),
    derivation,
    history: z.array(historyTurn),
    state: conversationState,
    input: z.string().min(1),
    inputSource: z.string().min(1),
    expected: z.strictObject({
      intent: z.string().min(1),
      // Campos de `entities` sem regra aqui são ignorados na avaliação.
      entities: z.array(fieldRule),
      missingFields: missingFieldsRule,
      expectedTool: z.enum([...TOOL_NAMES, "none"]),
      allowedExtraTools: z.array(z.enum(TOOL_NAMES)),
      // `null` quando expectedTool é "none".
      toolArgs: z
        .strictObject({
          fields: z.array(fieldRule),
          // Nomes de argumento que não podem aparecer em nenhuma chamada da tool esperada.
          forbidden: z.array(z.string().min(1)),
        })
        .nullable(),
    }),
    justification: z.array(justification).min(1),
  })
  .refine((c) => (c.expected.expectedTool === "none") === (c.expected.toolArgs === null), {
    message: 'toolArgs é null se, e só se, expectedTool é "none"',
  })
  // O histórico alterna usuário e assistente, começa pelo usuário e termina no assistente:
  // o turno avaliado (`input`) é a próxima mensagem do usuário.
  .refine((c) => c.history.every((turn, i) => turn.role === (i % 2 === 0 ? "user" : "assistant")), {
    message: "o histórico alterna user/assistant, começando por user",
  })
  .refine((c) => c.history.length % 2 === 0, { message: "o histórico termina num turno do assistente" });

export const casesFileSchema = z.strictObject({
  version: z.string().min(1),
  frozenAt: z.string().min(1),
  notes: z.array(z.string().min(1)),
  cases: z.array(caseSchema).length(6),
});

export type CasesFile = z.infer<typeof casesFileSchema>;
