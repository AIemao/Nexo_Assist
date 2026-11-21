// Raiz de composição do ticket-service: lê a configuração, monta as dependências,
// sobe o servidor HTTP (ADR-010) e encerra de forma ordenada em SIGINT/SIGTERM.
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { createCreateTicket } from "./application/create-ticket.js";
import { createListMyTickets } from "./application/list-my-tickets.js";
import { createViewMyTicket } from "./application/view-my-ticket.js";
import { PrismaClient } from "./generated/prisma/client.js";
import { createApp } from "./http/app.js";
import { readSimulatedFault, type SimulatedFault } from "./http/simulated-fault.js";
import type { ReadRecord } from "./http/read-record.js";
import type { WriteRecord } from "./http/write-record.js";
import { createErrorLogger } from "./observability/error-log.js";
import { readPrismaCode } from "./persistence/prisma-error-code.js";
import { createUnitOfWork } from "./persistence/unit-of-work.js";

interface Config {
  databaseUrl: string;
  host: string;
  port: number;
}

// O serviço não autentica e confia no ator informado pelo web (README §8);
// por isso escuta só na interface local, salvo configuração explícita.
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3001;

// Variável definida é validada como veio: valor vazio ou malformado é erro, nunca
// substituído pelo padrão nem convertido parcialmente.
function readConfig(env: NodeJS.ProcessEnv): { ok: true; config: Config } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  const databaseUrl = env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl === "") {
    errors.push("DATABASE_URL é obrigatória (ex.: file:./prisma/dev.db).");
  }

  const host = env["HOST"] ?? DEFAULT_HOST;
  if (host === "") {
    errors.push("HOST não pode ser vazio.");
  }

  const rawPort = env["PORT"];
  let port = DEFAULT_PORT;
  if (rawPort !== undefined) {
    port = /^[1-9][0-9]{0,4}$/.test(rawPort) ? Number(rawPort) : Number.NaN;
    if (!(port >= 1 && port <= 65535)) {
      errors.push(`PORT inválida: "${rawPort}". Use um inteiro de 1 a 65535.`);
    }
  }

  if (errors.length > 0 || databaseUrl === undefined) return { ok: false, errors };
  return { ok: true, config: { databaseUrl, host, port } };
}

function describeFault(fault: SimulatedFault): string {
  return fault.mode === "F-SLOW" ? `${fault.mode} (${fault.delayMs} ms)` : fault.mode;
}

// Cenários §1.1, IN2 e IN4 (escritas) e IL5 (leituras): uma linha JSON por registro no
// stdout, com o instante da emissão (`at`) carimbado aqui, e não no app. O formato de `at`
// é o mesmo dos instantes do domínio (DM §3.2): ISO 8601 em UTC, com milissegundos.
function recordLine(record: WriteRecord | ReadRecord): void {
  process.stdout.write(`${JSON.stringify({ ...record, at: new Date().toISOString() })}\n`);
}

// README §12 #22: registro de erros com campos permitidos. O leitor do código do Prisma é
// composto aqui, na raiz de composição, e nunca importado pela camada HTTP (ADR-008, condição 4).
const logError = createErrorLogger(readPrismaCode);

function formatAddress(info: AddressInfo): string {
  const host = info.family === "IPv6" ? `[${info.address}]` : info.address;
  return `http://${host}:${info.port}`;
}

function main(): void {
  const result = readConfig(process.env);
  // Cenários §2.2, FS1: a falha simulada só é ligada por configuração do processo.
  const faultResult = readSimulatedFault(process.env);
  if (!result.ok || !faultResult.ok) {
    const errors = [...(result.ok ? [] : result.errors), ...(faultResult.ok ? [] : [faultResult.message])];
    for (const error of errors) console.error(`Configuração inválida: ${error}`);
    process.exitCode = 1;
    return;
  }
  const { databaseUrl, host, port } = result.config;
  const { fault } = faultResult;
  if (fault !== undefined) {
    console.warn(`AVISO: falha simulada ativa: ${describeFault(fault)}`);
  }

  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
  const unitOfWork = createUnitOfWork(prisma);
  const clock = { now: () => new Date().toISOString() };
  const createTicket = createCreateTicket({
    unitOfWork,
    eventIdGenerator: { generate: randomUUID },
    clock,
  });
  const app = createApp({
    createTicket,
    listMyTickets: createListMyTickets({ unitOfWork, clock }),
    viewMyTicket: createViewMyTicket({ unitOfWork, clock }),
    onUnexpectedError: (error) => logError("request", error),
    simulatedFault: fault,
    recordWrite: recordLine,
    recordRead: recordLine,
  });

  const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
    console.log(`ticket-service ouvindo em ${formatAddress(info)}`);
  });

  // README §12 #22: o erro vai para o registro com campos permitidos, nunca inteiro.
  server.once("error", (error) => {
    logError("server", error);
    process.exit(1);
  });

  let shuttingDown = false;

  function shutdown(signal: NodeJS.Signals): void {
    // Idempotente: um segundo sinal não inicia outro encerramento.
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} recebido; encerrando.`);

    // close() para de aceitar conexões e só chama o callback depois que as
    // requisições em andamento terminam; o banco é desconectado depois disso.
    server.close((error) => {
      if (error) {
        // Sem $disconnect: requisições ainda podem estar usando o banco.
        logError("shutdown", error);
        process.exit(1);
      }
      prisma.$disconnect().then(
        () => {
          console.log("ticket-service encerrado.");
        },
        (disconnectError: unknown) => {
          logError("shutdown", disconnectError);
          process.exitCode = 1;
        },
      );
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
