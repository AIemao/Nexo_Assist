// Smoke test do servidor real (ADR-010, condição 3), separado dos testes de rota.
// Compila, migra bancos temporários e sobe `node dist/main.js` como processo filho.
// Etapa 1: duas requisições com a mesma chave e encerramento com SIGTERM, esperando código 0.
// Etapa 2 (cenários §2.2, FS8): reinício do servidor entre a gravação e a repetição, mesmo banco.
// Nas duas etapas, confere os registros das escritas no stdout de cada processo (cenários §1.1).
// Roda com `node scripts/smoke.ts` (remoção de tipos do Node); só usa módulos do Node
// e o better-sqlite3 (nada de src/).
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { deepStrictEqual } from "node:assert/strict";

const STEP_TIMEOUT_MS = 10_000;
const BUILD_TIMEOUT_MS = 120_000;

const serviceRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const tscCli = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
const prismaCli = require.resolve("prisma/build/index.js");

// O better-sqlite3 não traz tipos e o projeto não tem @types/better-sqlite3. Único ponto
// sem verificação de tipo: o require devolve any, descrito aqui só no que o smoke usa.
interface SqliteStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  close(): void;
}
const Sqlite: new (path: string, options: { readonly: boolean; fileMustExist: boolean }) => SqliteDatabase =
  require("better-sqlite3");

interface ChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

type JsonRecord = { [key: string]: unknown };

interface RunningChild {
  label: string;
  process: ChildProcess;
  exited: Promise<ChildExit>;
  baseUrl: string;
  stderrLine(pattern: RegExp): Promise<string>;
  step<T>(label: string, promise: Promise<T>): Promise<T>;
  // Cenários §1.1: registros das escritas lidos do stdout, na ordem de chegada.
  writeRecords: readonly JsonRecord[];
  waitForWriteRecords(stepLabel: string, count: number): Promise<void>;
  stdoutClosed: Promise<void>;
}

// Filhos ainda vivos, para o finally garantir que nenhum fique para trás.
const children: { process: ChildProcess; exited: Promise<ChildExit> }[] = [];

function log(message: string): void {
  console.log(`[smoke] ${message}`);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`tempo limite de ${ms} ms estourado: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function run(label: string, args: string[], env: NodeJS.ProcessEnv, timeout: number): void {
  try {
    execFileSync(process.execPath, args, { cwd: serviceRoot, env, stdio: "pipe", timeout });
  } catch (error) {
    const output = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`${label} falhou:\n${output.stdout?.toString() ?? ""}${output.stderr?.toString() ?? ""}`, {
      cause: error,
    });
  }
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === "string") throw new Error("porta livre não obtida");
  return address.port;
}

function migratedDatabase(tempDir: string, name: string): string {
  const databaseUrl = `file:${join(tempDir, name).replaceAll("\\", "/")}`;
  log(`aplicando migrações em ${databaseUrl}`);
  run("prisma migrate deploy", [prismaCli, "migrate", "deploy"], { ...process.env, DATABASE_URL: databaseUrl }, STEP_TIMEOUT_MS * 3);
  return databaseUrl;
}

// O ambiente do filho nunca herda falha simulada do ambiente de quem roda o smoke:
// cada processo recebe só as variáveis de falha que a etapa define.
function childEnv(databaseUrl: string, port: number, faultEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { SIMULATED_FAULT: _fault, SIMULATED_FAULT_DELAY_MS: _delay, ...inherited } = process.env;
  return { ...inherited, ...faultEnv, DATABASE_URL: databaseUrl, HOST: "127.0.0.1", PORT: String(port) };
}

async function startChild(label: string, databaseUrl: string, faultEnv: NodeJS.ProcessEnv): Promise<RunningChild> {
  const port = await freePort();
  log(`subindo ${label} (dist/main.js) na porta ${port}`);
  const spawned = spawn(process.execPath, ["dist/main.js"], {
    cwd: serviceRoot,
    env: childEnv(databaseUrl, port, faultEnv),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<ChildExit>((resolve) => {
    spawned.once("exit", (code, signal) => resolve({ code, signal }));
  });
  children.push({ process: spawned, exited });

  const stderrLines: string[] = [];
  const stderrWaiters: { pattern: RegExp; resolve: (line: string) => void }[] = [];
  createInterface({ input: spawned.stderr }).on("line", (line) => {
    console.error(`[${label}:stderr] ${line}`);
    stderrLines.push(line);
    for (const waiter of stderrWaiters) if (waiter.pattern.test(line)) waiter.resolve(line);
  });
  const stderrLine = (pattern: RegExp) =>
    new Promise<string>((resolve) => {
      const seen = stderrLines.find((line) => pattern.test(line));
      if (seen !== undefined) resolve(seen);
      else stderrWaiters.push({ pattern, resolve });
    });

  // Qualquer passo antes do encerramento falha se o filho terminar antes da hora.
  const untilChildDies = (stepLabel: string) =>
    exited.then((exit): never => {
      throw new Error(`processo ${label} terminou antes da hora (${stepLabel}): código ${exit.code}, sinal ${exit.signal}`);
    });
  // Toda rejeição sai com o nome do passo (ex.: "fetch failed" vira "(e) …: fetch failed").
  const step = <T>(stepLabel: string, promise: Promise<T>) => {
    const labelled = promise.catch((error: unknown): never => {
      throw new Error(`${stepLabel}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    });
    return withTimeout(Promise.race([labelled, untilChildDies(stepLabel)]), STEP_TIMEOUT_MS, stepLabel);
  };

  // Cenários §1.1, IN2: registro é só a linha JSON com event "ticket_write"; as linhas
  // de texto ("ouvindo em…", encerramento) ficam de fora.
  const writeRecords: JsonRecord[] = [];
  const stdout = createInterface({ input: spawned.stdout });
  const stdoutClosed = new Promise<void>((resolve) => stdout.once("close", resolve));
  const listening = new Promise<string>((resolve) => {
    stdout.on("line", (line) => {
      console.log(`[${label}] ${line}`);
      const record = parseWriteRecord(line);
      if (record !== undefined) writeRecords.push(record);
      const match = /ouvindo em (\S+)/.exec(line);
      if (match?.[1] !== undefined) resolve(match[1]);
    });
  });
  const baseUrl = await step(`${label}: esperando a linha de 'ouvindo'`, listening);
  log(`${label} pronto em ${baseUrl}`);

  let exitInfo: ChildExit | undefined;
  void exited.then((exit) => {
    exitInfo = exit;
  });
  // Espera os registros aparecerem antes de encerrar o filho, para não depender do
  // flush no encerramento. A falha diz o passo, o processo e o que chegou.
  const waitForWriteRecords = async (stepLabel: string, count: number): Promise<void> => {
    const deadline = Date.now() + STEP_TIMEOUT_MS;
    while (writeRecords.length < count) {
      const missing = `esperados ${count} registro(s) ticket_write no stdout de ${label}, recebidos ${writeRecords.length}: ${JSON.stringify(writeRecords)}`;
      if (exitInfo !== undefined) throw new Error(`${stepLabel}: ${label} terminou antes; ${missing}`);
      if (Date.now() > deadline) throw new Error(`${stepLabel}: tempo limite de ${STEP_TIMEOUT_MS} ms; ${missing}`);
      await sleep(50);
    }
  };

  return { label, process: spawned, exited, baseUrl, stderrLine, step, writeRecords, waitForWriteRecords, stdoutClosed };
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWriteRecord(line: string): JsonRecord | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  return isJsonRecord(value) && value["event"] === "ticket_write" ? value : undefined;
}

// Cenários §1.1, IN4: cada registro tem `at` em ISO 8601 e, sem o `at`, exatamente as
// chaves e os valores esperados para o seu desfecho (nada de título, descrição, ator ou
// corpo). `where` diz a etapa e o processo.
function assertWriteRecords(where: string, records: readonly JsonRecord[], expected: readonly JsonRecord[]): void {
  if (records.length !== expected.length) {
    throw new Error(
      `${where}: esperados exatamente ${expected.length} registro(s) ticket_write, recebidos ${records.length}: ${JSON.stringify(records)}`,
    );
  }
  records.forEach((record, index) => {
    const { at, ...rest } = record;
    if (typeof at !== "string" || Number.isNaN(Date.parse(at)) || new Date(at).toISOString() !== at) {
      throw new Error(`${where}: registro ${index + 1} sem 'at' ISO 8601 válido: ${JSON.stringify(record)}`);
    }
    try {
      deepStrictEqual(rest, expected[index]);
    } catch {
      throw new Error(
        `${where}: registro ${index + 1} diverge do esperado (IN4).\n` +
          `  esperado (sem at): ${JSON.stringify(expected[index])}\n` +
          `  recebido:          ${JSON.stringify(record)}`,
      );
    }
  });
}

// Corpo do 201: o smoke só precisa do id e do tipo do chamado.
function ticketIdentity(stepLabel: string, body: string): { id: string; type: string } {
  const ticket: unknown = JSON.parse(body);
  if (!isJsonRecord(ticket) || typeof ticket["id"] !== "string" || typeof ticket["type"] !== "string") {
    throw new Error(`${stepLabel}: corpo sem id ou type: ${body}`);
  }
  return { id: ticket["id"], type: ticket["type"] };
}

async function stopChild(child: RunningChild): Promise<void> {
  log(`enviando SIGTERM para ${child.label}`);
  child.process.kill("SIGTERM");
  const exit = await withTimeout(child.exited, STEP_TIMEOUT_MS, `${child.label}: encerramento após SIGTERM`);
  if (process.platform === "win32") {
    // No Windows o kill("SIGTERM") termina o filho sem passar pelo handler de sinal:
    // aqui só se exige que ele tenha terminado (o await acima).
    log(`${child.label} terminado (código ${exit.code}, sinal ${exit.signal})`);
    log("AVISO: encerramento ordenado não verificável no Windows (SIGTERM mata o processo); verificado na CI (Linux)");
  } else {
    if (exit.code !== 0 || exit.signal !== null) {
      throw new Error(
        `${child.label}: encerramento após SIGTERM: esperado código 0 e sinal null, recebido código ${exit.code}, sinal ${exit.signal}`,
      );
    }
    log(`${child.label} encerrado com código 0`);
  }
  // A contagem exata dos registros é feita depois do encerramento: espera o stdout do
  // filho fechar para nenhuma linha já escrita ficar de fora.
  await withTimeout(child.stdoutClosed, STEP_TIMEOUT_MS, `${child.label}: fechamento do stdout`);
}

const draft = {
  operation: "CREATE_TICKET",
  type: "INC",
  title: "Smoke test",
  description: "Chamado criado pelo smoke test do servidor real.",
  category: "HARDWARE",
  priority: "LOW",
  impactAssessment: { workImpact: "NONE", affectedScope: "SELF", commitmentRisk: "NO" },
  firstResponseDueAt: "1900-01-01T00:00:00.000Z",
};

async function postTicket(baseUrl: string, idempotencyKey: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`${baseUrl}/tickets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "X-Actor-Type": "EMPLOYEE",
      "X-Actor-Employee-Id": "EMP-001",
    },
    body: JSON.stringify(draft),
    signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
  });
  return { status: response.status, body: await response.text() };
}

function assertStatus(label: string, actual: number, expected: number, body: string): void {
  if (actual !== expected) throw new Error(`${label}: esperado HTTP ${expected}, recebido ${actual}. Corpo: ${body}`);
}

// Etapa 1: criação, repetição pela mesma chave e encerramento.
async function smokeCreateAndReplay(tempDir: string): Promise<void> {
  log("etapa 1: criação e repetição pela mesma chave");
  const databaseUrl = migratedDatabase(tempDir, "smoke.db");
  const server = await startChild("servidor", databaseUrl, {});

  const idempotencyKey = randomUUID();
  const first = await server.step("primeiro POST /tickets", postTicket(server.baseUrl, idempotencyKey));
  assertStatus("primeiro POST /tickets", first.status, 201, first.body);
  log(`primeiro POST /tickets → ${first.status} ${first.body}`);

  const second = await server.step("segundo POST /tickets (mesma chave)", postTicket(server.baseUrl, idempotencyKey));
  assertStatus("segundo POST /tickets", second.status, 201, second.body);
  deepStrictEqual(JSON.parse(second.body), JSON.parse(first.body), "a repetição deve devolver o mesmo corpo");
  log(`segundo POST /tickets (mesma chave) → ${second.status}, corpo idêntico`);
  const ticket = ticketIdentity("etapa 1, primeiro POST /tickets", first.body);

  await server.waitForWriteRecords("etapa 1, servidor: registros antes do SIGTERM", 2);
  await stopChild(server);

  // Cenários §1.1: criação e repetição, as duas entregues, com o mesmo ticketId.
  const success = { event: "ticket_write", operation: "CREATE", status: 201, idempotencyKey, ticketId: ticket.id };
  assertWriteRecords("etapa 1, servidor", server.writeRecords, [
    { ...success, outcome: "CREATED", responseDisposition: "SENT" },
    { ...success, outcome: "REPLAYED", responseDisposition: "SENT" },
  ]);
  log(`etapa 1: registros CREATED e REPLAYED de ${ticket.id}, SENT, sem fault`);
}

// Etapa 2 (FS8): A grava e perde a resposta (F-DROP-AFTER); B, sem falha e no mesmo banco,
// recebe a repetição e devolve o chamado gravado por A, sem gravar de novo.
async function smokeRestartBetweenWriteAndRetry(tempDir: string): Promise<void> {
  log("etapa 2: reinício entre a gravação e a repetição (FS8)");
  const databasePath = join(tempDir, "restart.db");
  const databaseUrl = migratedDatabase(tempDir, "restart.db");
  const idempotencyKey = randomUUID();

  // (a)
  const a = await startChild("A", databaseUrl, { SIMULATED_FAULT: "F-DROP-AFTER" });
  await a.step("(a) aviso de falha simulada ativa no stderr de A", a.stderrLine(/AVISO: falha simulada ativa: F-DROP-AFTER/));
  log("(a) A subiu com F-DROP-AFTER");

  // (b)
  const outcome = await a.step(
    "(b) POST /tickets em A",
    postTicket(a.baseUrl, idempotencyKey).then(
      (response) => ({ kind: "response" as const, ...response }),
      (error: unknown) => ({ kind: "error" as const, error }),
    ),
  );
  if (outcome.kind === "response") {
    throw new Error(`(b) POST /tickets em A: esperada conexão encerrada sem resposta, recebido HTTP ${outcome.status}. Corpo: ${outcome.body}`);
  }
  if (!(outcome.error instanceof TypeError)) {
    throw new Error(`(b) POST /tickets em A: esperada conexão encerrada (TypeError), recebido ${String(outcome.error)}`);
  }
  log("(b) POST em A: conexão encerrada sem resposta HTTP");

  // (c)
  await a.waitForWriteRecords("etapa 2, A: registro do corte antes do SIGTERM", 1);
  await stopChild(a);

  // Cenários §1.1: A gravou e cortou a resposta (CREATED com o 201 que seria enviado).
  const cut = a.writeRecords[0];
  const cutTicketId = cut?.["ticketId"];
  if (typeof cutTicketId !== "string") {
    throw new Error(`etapa 2, A: registro do corte sem ticketId: ${JSON.stringify(a.writeRecords)}`);
  }
  const success = { event: "ticket_write", operation: "CREATE", status: 201, idempotencyKey, ticketId: cutTicketId };
  assertWriteRecords("etapa 2, A", a.writeRecords, [
    { ...success, outcome: "CREATED", fault: "F-DROP-AFTER", responseDisposition: "DROPPED" },
  ]);
  log(`etapa 2, A: registro CREATED de ${cutTicketId}, F-DROP-AFTER, DROPPED`);

  // (d)
  const b = await startChild("B", databaseUrl, {});

  // (e)
  const retry = await b.step("(e) POST /tickets em B (mesma chave e corpo)", postTicket(b.baseUrl, idempotencyKey));
  assertStatus("(e) POST /tickets em B", retry.status, 201, retry.body);
  const ticket = ticketIdentity("(e) POST /tickets em B", retry.body);
  log(`(e) POST em B → 201, chamado ${ticket.id}`);

  // (f)
  await b.waitForWriteRecords("etapa 2, B: registro da repetição antes do SIGTERM", 1);
  await stopChild(b);

  // B repete com a mesma chave: REPLAYED, entregue, com o MESMO ticketId do registro de A
  // (e o mesmo do corpo HTTP de B).
  if (ticket.id !== cutTicketId) {
    throw new Error(`etapa 2: B devolveu ${ticket.id}, mas o registro do corte em A tem ticketId ${cutTicketId}`);
  }
  assertWriteRecords("etapa 2, B", b.writeRecords, [
    { ...success, outcome: "REPLAYED", responseDisposition: "SENT" },
  ]);
  log(`etapa 2, B: registro REPLAYED de ${ticket.id}, SENT, sem fault`);

  // (g)
  const db = new Sqlite(databasePath, { readonly: true, fileMustExist: true });
  try {
    const ticketIds = db.prepare('SELECT "id" FROM "Ticket"').all();
    deepStrictEqual(ticketIds, [{ id: ticket.id }], `(g) Ticket: esperada 1 linha com id ${ticket.id}`);
    deepStrictEqual(db.prepare('SELECT COUNT(*) AS "n" FROM "TicketEvent"').get(), { n: 1 }, "(g) TicketEvent: esperada 1 linha");
    deepStrictEqual(db.prepare('SELECT COUNT(*) AS "n" FROM "IdempotencyRecord"').get(), { n: 1 }, "(g) IdempotencyRecord: esperada 1 linha");
    deepStrictEqual(
      db.prepare('SELECT "lastNumber" FROM "TicketCounter" WHERE "type" = ?').get(ticket.type),
      { lastNumber: 1 },
      `(g) TicketCounter: esperado lastNumber 1 para ${ticket.type}`,
    );
  } finally {
    db.close();
  }
  log("(g) banco: 1 Ticket, 1 TicketEvent, 1 IdempotencyRecord, lastNumber 1");
}

async function smoke(): Promise<void> {
  let tempDir: string | undefined;

  try {
    log("compilando (tsconfig.build.json)");
    run("build", [tscCli, "-p", "tsconfig.build.json"], process.env, BUILD_TIMEOUT_MS);

    tempDir = mkdtempSync(join(tmpdir(), "nexo-ticket-smoke-"));
    await smokeCreateAndReplay(tempDir);
    await smokeRestartBetweenWriteAndRetry(tempDir);
    log("OK");
  } finally {
    // Em qualquer saída: nenhum filho fica vivo e os bancos temporários são apagados.
    for (const child of children) {
      if (child.process.exitCode === null && child.process.signalCode === null) {
        child.process.kill("SIGKILL");
        await withTimeout(child.exited, STEP_TIMEOUT_MS, "SIGKILL do filho").catch(() => undefined);
      }
    }
    if (tempDir !== undefined) {
      // No Windows o arquivo pode seguir travado logo após o fim do processo.
      rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

smoke().catch((error: unknown) => {
  console.error("[smoke] FALHOU:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
