import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// Ticket-service falso para os testes do web: escuta em 127.0.0.1, porta 0, responde por roteiro
// e grava cada requisição recebida (método, caminho, cabeçalhos e corpo cru).
export interface FakeReply {
  status: number;
  body?: unknown;
  delayMs?: number;
}

export interface SeenRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

export interface FakeTicketService {
  baseUrl: string;
  requests: SeenRequest[];
  // Respostas na ordem das requisições; depois do roteiro, repete a última.
  script(replies: FakeReply[]): void;
  close(): Promise<void>;
}

export async function startFakeTicketService(): Promise<FakeTicketService> {
  let replies: FakeReply[] = [{ status: 500 }];
  const requests: SeenRequest[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      requests.push({ method: req.method ?? "", path: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      const reply = replies[requests.length - 1] ?? replies.at(-1) ?? { status: 500 };
      const send = () => {
        if (res.destroyed) return;
        res.writeHead(reply.status, { "content-type": "application/json" });
        res.end(reply.body === undefined ? "" : JSON.stringify(reply.body));
      };
      if (reply.delayMs === undefined) send();
      else setTimeout(send, reply.delayMs);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    script(next) {
      replies = next;
      requests.length = 0;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export const ANA = { id: "EMP-A", name: "Ana Souza", email: "ana@nexo.example", department: "Operações", role: "EMPLOYEE" };
export const CARLA = { id: "ANALYST-1", name: "Carla Mendes", email: "carla@nexo.example", department: "Service Desk", role: "ANALYST" };
export const NOT_FOUND = { type: "about:blank", title: "Not Found", status: 404, code: "EMPLOYEE_NOT_FOUND" };

// Leituras de chamados (contrato §8 e §9). Cenários v1.15 §2.1, S3: os testes nunca fixam ids; usam
// este mapa rótulo → id, como o mapa impresso pelo seed. S9: TKT-X é INC-999999.
const seedId = (n: number) => `INC-${n}`;
export const SEED_TICKET_IDS = Object.freeze({ "TKT-A1": seedId(1), "TKT-A2": seedId(2), "TKT-B1": seedId(3) });
export const TKT_X = "INC-999999";
export const TICKET_NOT_FOUND = { type: "about:blank", title: "Not Found", status: 404, code: "TICKET_NOT_FOUND" };

// Item da listagem (§8.2): TKT-A1 aberto; TKT-A2 resolvido, com resolvedAt e isOverdue null.
export const SUMMARY_A1 = {
  id: SEED_TICKET_IDS["TKT-A1"],
  type: "INC",
  title: "Notebook lento",
  category: "HARDWARE",
  priority: "MEDIUM",
  status: "WAITING_ANALYST",
  createdAt: "2026-11-20T14:40:00.000Z",
  updatedAt: "2026-11-20T14:40:00.000Z",
  currentDueAt: "2026-11-25T14:40:00.000Z",
  isOverdue: false,
};
export const SUMMARY_A2 = {
  id: SEED_TICKET_IDS["TKT-A2"],
  type: "INC",
  title: "Senha do SAP não funciona",
  category: "ACCESS",
  priority: "MEDIUM",
  status: "RESOLVED",
  createdAt: "2026-11-14T15:00:00.000Z",
  updatedAt: "2026-11-16T15:00:00.000Z",
  resolvedAt: "2026-11-16T15:00:00.000Z",
  currentDueAt: "2026-11-18T21:00:00.000Z",
  isOverdue: null,
};

// Detalhe (§9.1): o objeto ticket inteiro do DM §3.2, mais currentDueAt e isOverdue.
export const DETAIL_A1 = {
  id: SEED_TICKET_IDS["TKT-A1"],
  version: 1,
  type: "INC",
  title: "Notebook lento",
  description: "O notebook está lento para abrir programas desde a última atualização.",
  category: "HARDWARE",
  priority: "MEDIUM",
  status: "WAITING_ANALYST",
  requesterId: "EMP-A",
  impactAssessment: { affectedScope: "SELF", workImpact: "DEGRADED_WITH_WORKAROUND", commitmentRisk: "NO" },
  createdAt: "2026-11-20T14:40:00.000Z",
  updatedAt: "2026-11-20T14:40:00.000Z",
  firstResponseDueAt: "2026-11-25T14:40:00.000Z",
  currentDueAt: "2026-11-25T14:40:00.000Z",
  isOverdue: false,
};

// TKT-A2 resolvido, coerente com o SUMMARY_A2: resolvedAt presente e isOverdue null (contrato §12).
export const DETAIL_A2 = {
  id: SEED_TICKET_IDS["TKT-A2"],
  version: 2,
  type: "INC",
  title: "Senha do SAP não funciona",
  description: "A senha do SAP é recusada no login.",
  category: "ACCESS",
  priority: "MEDIUM",
  status: "RESOLVED",
  requesterId: "EMP-A",
  impactAssessment: { affectedScope: "SELF", workImpact: "DEGRADED_WITH_WORKAROUND", commitmentRisk: "NO" },
  createdAt: "2026-11-14T15:00:00.000Z",
  updatedAt: "2026-11-16T15:00:00.000Z",
  resolvedAt: "2026-11-16T15:00:00.000Z",
  firstResponseDueAt: "2026-11-18T21:00:00.000Z",
  currentDueAt: "2026-11-18T21:00:00.000Z",
  isOverdue: null,
};
