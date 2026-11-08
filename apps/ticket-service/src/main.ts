// Raiz de composição do ticket-service: lê a configuração, monta as dependências,
// sobe o servidor HTTP (ADR-010) e encerra de forma ordenada em SIGINT/SIGTERM.
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { createCreateTicket } from "./application/create-ticket.js";
import { PrismaClient } from "./generated/prisma/client.js";
import { createApp } from "./http/app.js";
import { readSimulatedFault, type SimulatedFault } from "./http/simulated-fault.js";
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
  const createTicket = createCreateTicket({
    unitOfWork: createUnitOfWork(prisma),
    eventIdGenerator: { generate: randomUUID },
    clock: { now: () => new Date().toISOString() },
  });
  const app = createApp({ createTicket, simulatedFault: fault });

  const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
    console.log(`ticket-service ouvindo em ${formatAddress(info)}`);
  });

  server.once("error", (error) => {
    console.error("Falha no servidor HTTP:", error);
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
        console.error("Falha ao fechar o servidor HTTP:", error);
        process.exit(1);
      }
      prisma.$disconnect().then(
        () => {
          console.log("ticket-service encerrado.");
        },
        (disconnectError: unknown) => {
          console.error("Falha ao desconectar o banco:", disconnectError);
          process.exitCode = 1;
        },
      );
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
