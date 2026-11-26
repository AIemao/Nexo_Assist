import { AFFECTED_SCOPES, COMMITMENT_RISKS, TICKET_CATEGORIES, TICKET_TYPES, WORK_IMPACTS } from "@nexo/contracts";
import { z } from "zod";
import { MESSAGE_ATTACHMENT_KINDS } from "../../domain/conversation";

// Colunas JSON do web, validadas por Zod na gravação e na leitura (plano T4): o Prisma não valida
// o conteúdo de uma coluna Json (lição do ADR-008 sobre escrita fora do Prisma).

// DM §3.5, InteractionContext.collectedData.
export const collectedDataSchema = z.strictObject({
  title: z.string().optional(),
  description: z.string().optional(),
  type: z.enum(TICKET_TYPES).optional(),
  category: z.enum(TICKET_CATEGORIES).optional(),
  impactAssessment: z
    .strictObject({
      affectedScope: z.enum(AFFECTED_SCOPES).optional(),
      workImpact: z.enum(WORK_IMPACTS).optional(),
      commitmentRisk: z.enum(COMMITMENT_RISKS).optional(),
    })
    .optional(),
  additionalInformation: z.string().optional(),
  reason: z.string().optional(),
});

// DM §3.8, Message.attachments: ordem preservada.
export const attachmentsSchema = z.array(
  z.strictObject({
    kind: z.enum(MESSAGE_ATTACHMENT_KINDS),
    refId: z.string().min(1),
  }),
);
