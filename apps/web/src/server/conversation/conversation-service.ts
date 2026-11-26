import type { Conversation } from "../../domain/conversation";
import { isBusyTimeout, isUniqueViolation } from "../persistence/prisma-errors";
import type { UnitOfWork } from "../persistence/unit-of-work";
import type { Clock, IdGenerator } from "../runtime";

// Tentativas de criação quando outra conexão segura o lock de escrita (SQLITE_BUSY).
const MAX_CREATE_ATTEMPTS = 3;

// DM v2.19 §3.5 e invariante 17: no máximo uma conversa não encerrada por funcionário, garantida na
// persistência pelo índice único de openOwnerEmployeeId (plano T5). A conversa nasce na primeira
// mensagem, nunca no login.
//
// Obter ou criar:
// 1. leitura numa Unit of Work;
// 2. sem conversa não encerrada, criação numa Unit of Work só com o INSERT (uma instrução: nenhum
//    lock é segurado entre leituras e a escrita);
// 3. em P2002 (outra conexão criou antes), releitura numa NOVA Unit of Work, que devolve a conversa
//    criada pela outra conexão;
// 4. em SQLITE_BUSY (P1008: outra conexão segurou o lock além do busy_timeout), releitura numa NOVA
//    Unit of Work e, se ainda não houver conversa, nova tentativa de criação.
// O índice único é a garantia; os passos 3 e 4 só fazem as duas chamadas devolverem a mesma conversa.
// Não é preciso saber qual restrição única gerou o P2002: a releitura decide. Um P2002 de outra
// restrição (por exemplo, id repetido) cai na releitura vazia e é relançado. Todo P1008 é tratado do
// mesmo jeito, porque a resposta (reler e, sem conversa, tentar de novo até o limite) é segura para
// qualquer timeout: nada é gravado fora do INSERT protegido pelo índice.
// [Inferência] O caso 4 aparece com duas conexões no mesmo processo: o better-sqlite3 é síncrono, e a
// espera pelo lock bloqueia a thread que faria o COMMIT da outra conexão até o busy_timeout estourar.
export async function getOrCreateOpenConversation(
  unitOfWork: UnitOfWork,
  ownerEmployeeId: string,
  deps: { clock: Clock; ids: IdGenerator },
): Promise<Conversation> {
  const findOpen = () => unitOfWork.execute(({ conversations }) => conversations.findOpenByOwner(ownerEmployeeId));

  const existing = await findOpen();
  if (existing !== undefined) return existing;

  for (let attempt = 1; ; attempt++) {
    const now = deps.clock.now().toISOString();
    try {
      return await unitOfWork.execute(({ conversations }) =>
        conversations.create({
          id: deps.ids.generate(),
          ownerEmployeeId,
          status: "AI_ACTIVE",
          interactionContext: { flow: "NONE", stage: "IDLE" },
          createdAt: now,
          updatedAt: now,
        }),
      );
    } catch (error) {
      const unique = isUniqueViolation(error);
      if (!unique && !isBusyTimeout(error)) throw error;
      const created = await findOpen();
      if (created !== undefined) return created;
      if (unique || attempt >= MAX_CREATE_ATTEMPTS) throw error;
    }
  }
}
