import { describe, expect, it } from "vitest";
import type { Conversation } from "../src/domain/conversation";
import { Prisma } from "../src/generated/prisma/client";
import { getOrCreateOpenConversation } from "../src/server/conversation/conversation-service";
import type { ConversationRepository } from "../src/server/persistence/conversation-repository";
import type { MessageRepository } from "../src/server/persistence/message-repository";
import type { SessionRepository } from "../src/server/persistence/session-repository";
import type { UnitOfWork } from "../src/server/persistence/unit-of-work";
import type { Clock, IdGenerator } from "../src/server/runtime";

const clock: Clock = { now: () => new Date("2026-11-22T12:00:00.000Z") };
const ids: IdGenerator = { generate: () => "nova" };

const prismaError = (code: string) => new Prisma.PrismaClientKnownRequestError(`erro ${code}`, { code, clientVersion: "7.10.1" });

const conversation = (id: string): Conversation => ({
  id,
  ownerEmployeeId: "EMP-A",
  status: "AI_ACTIVE",
  interactionContext: { flow: "NONE", stage: "IDLE" },
  createdAt: "2026-11-22T12:00:00.000Z",
  updatedAt: "2026-11-22T12:00:00.000Z",
});

const unused = (): never => {
  throw new Error("não usado neste teste");
};

// Unit of Work falsa: cada leitura e cada criação seguem um roteiro; registra as chamadas.
function fakeUnitOfWork(script: { reads: (Conversation | undefined)[]; creates: (Conversation | Error)[] }) {
  const calls: string[] = [];
  let read = 0;
  let create = 0;
  const conversations: ConversationRepository = {
    async findOpenByOwner() {
      calls.push("read");
      return script.reads[read++];
    },
    async create() {
      calls.push("create");
      const next = script.creates[create++];
      if (next === undefined) throw new Error("criação fora do roteiro");
      if (next instanceof Error) throw next;
      return next;
    },
    findById: unused,
    updateInteractionContext: unused,
    close: unused,
  };
  const sessions: SessionRepository = { create: unused, findByTokenHash: unused, revoke: unused, deleteExpiredBefore: unused, count: unused };
  const messages: MessageRepository = { append: unused, listByConversation: unused };
  const unitOfWork: UnitOfWork = {
    execute(work) {
      calls.push("uow");
      return work({ sessions, conversations, messages });
    },
  };
  return { unitOfWork, calls };
}

describe("getOrCreateOpenConversation: caminhos de erro (invariante 17; plano T5)", () => {
  it("(a) P2002 → releitura numa nova Unit of Work devolve a conversa da outra conexão", async () => {
    const { unitOfWork, calls } = fakeUnitOfWork({ reads: [undefined, conversation("da-outra")], creates: [prismaError("P2002")] });
    expect((await getOrCreateOpenConversation(unitOfWork, "EMP-A", { clock, ids })).id).toBe("da-outra");
    expect(calls).toStrictEqual(["uow", "read", "uow", "create", "uow", "read"]);
  });

  it("(b) P1008 na primeira tentativa → releitura vazia → nova tentativa com sucesso", async () => {
    const { unitOfWork, calls } = fakeUnitOfWork({
      reads: [undefined, undefined],
      creates: [prismaError("P1008"), conversation("nova")],
    });
    expect((await getOrCreateOpenConversation(unitOfWork, "EMP-A", { clock, ids })).id).toBe("nova");
    expect(calls).toStrictEqual(["uow", "read", "uow", "create", "uow", "read", "uow", "create"]);
  });

  it("(c) P1008 nas três tentativas → lança o P1008", async () => {
    const { unitOfWork, calls } = fakeUnitOfWork({
      reads: [undefined, undefined, undefined, undefined],
      creates: [prismaError("P1008"), prismaError("P1008"), prismaError("P1008")],
    });
    const error = await getOrCreateOpenConversation(unitOfWork, "EMP-A", { clock, ids }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(error instanceof Prisma.PrismaClientKnownRequestError && error.code).toBe("P1008");
    expect(calls.filter((c) => c === "create")).toHaveLength(3);
  });

  it("(d) P2002 com releitura vazia → lança o P2002, sem nova tentativa", async () => {
    const { unitOfWork, calls } = fakeUnitOfWork({ reads: [undefined, undefined], creates: [prismaError("P2002")] });
    const error = await getOrCreateOpenConversation(unitOfWork, "EMP-A", { clock, ids }).catch((e: unknown) => e);
    expect(error instanceof Prisma.PrismaClientKnownRequestError && error.code).toBe("P2002");
    expect(calls.filter((c) => c === "create")).toHaveLength(1);
  });

  it("outro erro do banco → lança sem releitura", async () => {
    const { unitOfWork, calls } = fakeUnitOfWork({ reads: [undefined], creates: [prismaError("P2003")] });
    await expect(getOrCreateOpenConversation(unitOfWork, "EMP-A", { clock, ids })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    expect(calls).toStrictEqual(["uow", "read", "uow", "create"]);
  });
});
