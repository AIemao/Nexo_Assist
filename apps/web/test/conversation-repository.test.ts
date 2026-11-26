import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  INTERACTION_FLOWS,
  INTERACTION_STAGES,
  VALID_FLOW_STAGES,
  isValidFlowStage,
  type Conversation,
  type Message,
} from "../src/domain/conversation";
import { ConversationNotOpenError, InvalidConversationError } from "../src/server/persistence/conversation-repository";
import { InvalidMessageError } from "../src/server/persistence/message-repository";
import { createUnitOfWork, type UnitOfWork } from "../src/server/persistence/unit-of-work";
import { createTestDatabase, type TestDatabase } from "./support/test-database";

const NOW = "2026-11-22T12:00:00.000Z";
const conversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: "conv-1",
  ownerEmployeeId: "EMP-A",
  status: "AI_ACTIVE",
  interactionContext: { flow: "NONE", stage: "IDLE" },
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

describe("repositório de conversa (DM v2.19 §3.5; AF §3)", () => {
  let database: TestDatabase;
  let uow: UnitOfWork;

  beforeEach(() => {
    database = createTestDatabase();
    uow = createUnitOfWork(database.prisma);
  });
  afterEach(async () => {
    await database.dispose();
  });

  it("o catálogo tem exatamente as 10 combinações válidas do AF §3", () => {
    expect(VALID_FLOW_STAGES).toHaveLength(10);
    const valid = INTERACTION_FLOWS.flatMap((flow) => INTERACTION_STAGES.filter((stage) => isValidFlowStage(flow, stage)));
    expect(valid).toHaveLength(10);
  });

  it.each(VALID_FLOW_STAGES)("aceita a combinação válida %s/%s", async (flow, stage) => {
    const created = await uow.execute(({ conversations }) =>
      conversations.create(conversation({ interactionContext: { flow, stage } })),
    );
    expect(created.interactionContext).toStrictEqual({ flow, stage });
  });

  it.each([
    ["NONE", "COLLECTING_DETAILS"],
    ["TICKET_LOOKUP", "IDLE"],
    ["CREATE_TICKET", "SELECTING_TICKET"],
    ["TICKET_LOOKUP", "READY_TO_PROPOSE"],
  ] as const)("recusa antes de gravar a combinação inválida %s/%s", async (flow, stage) => {
    await expect(
      uow.execute(({ conversations }) => conversations.create(conversation({ interactionContext: { flow, stage } }))),
    ).rejects.toThrow(InvalidConversationError);
    expect(await database.prisma.conversation.count()).toBe(0);
  });

  it("recusa combinação inválida também na atualização do contexto", async () => {
    await uow.execute(({ conversations }) => conversations.create(conversation()));
    await expect(
      uow.execute(({ conversations }) =>
        conversations.updateInteractionContext("conv-1", { flow: "NONE", stage: "SELECTING_TICKET" }, NOW),
      ),
    ).rejects.toThrow(InvalidConversationError);
  });

  it("guarda e devolve targetTicketId e collectedData validados", async () => {
    const context = {
      flow: "CREATE_TICKET" as const,
      stage: "COLLECTING_DETAILS" as const,
      collectedData: { category: "NETWORK_VPN" as const, impactAssessment: { workImpact: "BLOCKED" as const } },
    };
    await uow.execute(({ conversations }) => conversations.create(conversation({ interactionContext: context })));
    const found = await uow.execute(({ conversations }) => conversations.findOpenByOwner("EMP-A"));
    expect(found?.interactionContext).toStrictEqual(context);
  });

  it("atualização para um contexto sem collectedData nem targetTicketId zera as duas colunas", async () => {
    await uow.execute(({ conversations }) =>
      conversations.create(
        conversation({
          interactionContext: {
            flow: "CREATE_TICKET",
            stage: "COLLECTING_DETAILS",
            targetTicketId: "INC-1",
            collectedData: { title: "Notebook lento", type: "INC" },
          },
        }),
      ),
    );
    const updated = await uow.execute(({ conversations }) =>
      conversations.updateInteractionContext("conv-1", { flow: "NONE", stage: "IDLE" }, NOW),
    );
    expect(updated.interactionContext).toStrictEqual({ flow: "NONE", stage: "IDLE" });
    const row = await database.prisma.conversation.findUnique({ where: { id: "conv-1" } });
    expect(row?.collectedData).toBeNull();
    expect(row?.targetTicketId).toBeNull();
    const reread = await uow.execute(({ conversations }) => conversations.findById("conv-1"));
    expect(reread?.interactionContext).toStrictEqual({ flow: "NONE", stage: "IDLE" });
  });

  it("recusa criar com assignedAnalystId fora de ANALYST_ACTIVE (DM §7.2)", async () => {
    await expect(
      uow.execute(({ conversations }) => conversations.create(conversation({ assignedAnalystId: "ANALYST-1" }))),
    ).rejects.toThrow(InvalidConversationError);
    expect(await database.prisma.conversation.count()).toBe(0);
  });

  it("aceita assignedAnalystId em ANALYST_ACTIVE", async () => {
    const created = await uow.execute(({ conversations }) =>
      conversations.create(conversation({ status: "ANALYST_ACTIVE", assignedAnalystId: "ANALYST-1" })),
    );
    expect(created.assignedAnalystId).toBe("ANALYST-1");
  });

  it("recusa criar com resolutionSource fora de CLOSED (DM §7.2)", async () => {
    await expect(
      uow.execute(({ conversations }) => conversations.create(conversation({ resolutionSource: "AGENT" }))),
    ).rejects.toThrow(InvalidConversationError);
    expect(await database.prisma.conversation.count()).toBe(0);
  });

  it("recusa encerrar uma conversa já CLOSED (DM §7.1, invariante 15)", async () => {
    await uow.execute(({ conversations }) =>
      conversations.create(conversation({ status: "CLOSED", resolutionSource: "ANALYST" })),
    );
    await expect(uow.execute(({ conversations }) => conversations.close("conv-1", "AGENT", NOW))).rejects.toThrow(
      ConversationNotOpenError,
    );
    const row = await database.prisma.conversation.findUnique({ where: { id: "conv-1" } });
    expect(row?.resolutionSource).toBe("ANALYST");
  });

  it("recusa collectedData fora do contrato", async () => {
    await expect(
      uow.execute(({ conversations }) =>
        conversations.create(
          conversation({
            interactionContext: {
              flow: "CREATE_TICKET",
              stage: "COLLECTING_DETAILS",
              collectedData: JSON.parse('{"category":"INVALIDA"}'),
            },
          }),
        ),
      ),
    ).rejects.toThrow(InvalidConversationError);
  });

  it("encerrar: CLOSED, resolutionSource, openOwnerEmployeeId null; encerrar de novo é recusado", async () => {
    await uow.execute(({ conversations }) => conversations.create(conversation()));
    const closed = await uow.execute(({ conversations }) => conversations.close("conv-1", "AGENT", NOW));
    expect(closed).toMatchObject({ status: "CLOSED", resolutionSource: "AGENT" });
    const row = await database.prisma.conversation.findUnique({ where: { id: "conv-1" } });
    expect(row?.openOwnerEmployeeId).toBeNull();
    expect(await uow.execute(({ conversations }) => conversations.findOpenByOwner("EMP-A"))).toBeUndefined();
    await expect(uow.execute(({ conversations }) => conversations.close("conv-1", "AGENT", NOW))).rejects.toThrow(ConversationNotOpenError);
  });
});

describe("repositório de mensagem (DM v2.19 §3.8)", () => {
  let database: TestDatabase;
  let uow: UnitOfWork;

  const message = (id: string, overrides: Partial<Message> = {}): Message => ({
    id,
    conversationId: "conv-1",
    author: { type: "EMPLOYEE", employeeId: "EMP-A" },
    content: `conteúdo ${id}`,
    attachments: [],
    createdAt: NOW,
    ...overrides,
  });

  beforeEach(async () => {
    database = createTestDatabase();
    uow = createUnitOfWork(database.prisma);
    await uow.execute(({ conversations }) => conversations.create(conversation()));
  });
  afterEach(async () => {
    await database.dispose();
  });

  it("acrescenta e lista em ordem, com autor, anexos e decisionRecordId", async () => {
    const agent = message("m2", {
      author: { type: "AGENT" },
      decisionRecordId: "dr-1",
      attachments: [
        { kind: "TICKET_SELECTOR", refId: "dr-1" },
        { kind: "TICKET", refId: "INC-1" },
      ],
    });
    await uow.execute(({ messages }) => messages.append(message("m1")));
    await uow.execute(({ messages }) => messages.append(agent));
    await uow.execute(({ messages }) => messages.append(message("m3", { author: { type: "SYSTEM" } })));
    const listed = await uow.execute(({ messages }) => messages.listByConversation("conv-1"));
    expect(listed.map((m) => m.id)).toStrictEqual(["m1", "m2", "m3"]);
    expect(listed[1]).toStrictEqual(agent);
  });

  it("aceita content vazio (o DM §3.8 não o recusa; a rota valida a mensagem do funcionário)", async () => {
    await uow.execute(({ messages }) => messages.append(message("m1", { content: "" })));
    const listed = await uow.execute(({ messages }) => messages.listByConversation("conv-1"));
    expect(listed[0]?.content).toBe("");
  });

  it("recusa anexo fora do contrato", async () => {
    await expect(
      uow.execute(({ messages }) => messages.append(message("m1", { attachments: JSON.parse('[{"kind":"CARD","refId":"x"}]') }))),
    ).rejects.toThrow(InvalidMessageError);
  });
});
