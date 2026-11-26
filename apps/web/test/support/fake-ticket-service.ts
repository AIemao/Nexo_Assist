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
