// Smoke test do servidor real (ADR-010, condição 3), separado dos testes de rota.
// Compila, migra um banco temporário, sobe `node dist/main.js` como processo filho,
// faz duas requisições com a mesma chave e encerra com SIGTERM, esperando código 0.
// Roda com `node scripts/smoke.ts` (remoção de tipos do Node); só usa módulos do Node.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { deepStrictEqual } from "node:assert/strict";

const STEP_TIMEOUT_MS = 10_000;
const BUILD_TIMEOUT_MS = 120_000;

const serviceRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const tscCli = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
const prismaCli = require.resolve("prisma/build/index.js");

interface ChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

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

async function smoke(): Promise<void> {
  let child: ChildProcess | undefined;
  let childExit: Promise<ChildExit> | undefined;
  let tempDir: string | undefined;

  try {
    log("compilando (tsconfig.build.json)");
    run("build", [tscCli, "-p", "tsconfig.build.json"], process.env, BUILD_TIMEOUT_MS);

    tempDir = mkdtempSync(join(tmpdir(), "nexo-ticket-smoke-"));
    const databaseUrl = `file:${join(tempDir, "smoke.db").replaceAll("\\", "/")}`;
    log(`aplicando migrações em ${databaseUrl}`);
    run("prisma migrate deploy", [prismaCli, "migrate", "deploy"], { ...process.env, DATABASE_URL: databaseUrl }, STEP_TIMEOUT_MS * 3);

    const port = await freePort();
    log(`subindo dist/main.js na porta ${port}`);
    const spawned = spawn(process.execPath, ["dist/main.js"], {
      cwd: serviceRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl, HOST: "127.0.0.1", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child = spawned;
    childExit = new Promise<ChildExit>((resolve) => {
      spawned.once("exit", (code, signal) => resolve({ code, signal }));
    });
    const exited = childExit;

    const stdout = createInterface({ input: spawned.stdout });
    createInterface({ input: spawned.stderr }).on("line", (line) => console.error(`[filho:stderr] ${line}`));

    // Qualquer passo antes do SIGTERM falha se o filho terminar antes da hora.
    const untilChildDies = (label: string) =>
      exited.then((exit): never => {
        throw new Error(`processo filho terminou antes da hora (${label}): código ${exit.code}, sinal ${exit.signal}`);
      });
    const step = <T>(label: string, promise: Promise<T>) =>
      withTimeout(Promise.race([promise, untilChildDies(label)]), STEP_TIMEOUT_MS, label);

    const listening = new Promise<string>((resolve) => {
      stdout.on("line", (line) => {
        console.log(`[filho] ${line}`);
        const match = /ouvindo em (\S+)/.exec(line);
        if (match?.[1] !== undefined) resolve(match[1]);
      });
    });
    const baseUrl = await step("esperando a linha de 'ouvindo'", listening);
    log(`servidor pronto em ${baseUrl}`);

    const idempotencyKey = randomUUID();
    const first = await step("primeiro POST /tickets", postTicket(baseUrl, idempotencyKey));
    assertStatus("primeiro POST /tickets", first.status, 201, first.body);
    log(`primeiro POST /tickets → ${first.status} ${first.body}`);

    const second = await step("segundo POST /tickets (mesma chave)", postTicket(baseUrl, idempotencyKey));
    assertStatus("segundo POST /tickets", second.status, 201, second.body);
    deepStrictEqual(JSON.parse(second.body), JSON.parse(first.body), "a repetição deve devolver o mesmo corpo");
    log(`segundo POST /tickets (mesma chave) → ${second.status}, corpo idêntico`);

    log("enviando SIGTERM");
    spawned.kill("SIGTERM");
    const exit = await withTimeout(exited, STEP_TIMEOUT_MS, "encerramento após SIGTERM");
    if (process.platform === "win32") {
      // No Windows o kill("SIGTERM") termina o filho sem passar pelo handler de sinal:
      // aqui só se exige que ele tenha terminado (o await acima).
      log(`filho terminado (código ${exit.code}, sinal ${exit.signal})`);
      log("AVISO: encerramento ordenado não verificável no Windows (SIGTERM mata o processo); verificado na CI (Linux)");
    } else {
      if (exit.code !== 0 || exit.signal !== null) {
        throw new Error(`encerramento após SIGTERM: esperado código 0 e sinal null, recebido código ${exit.code}, sinal ${exit.signal}`);
      }
      log("filho encerrado com código 0");
    }
    log("OK");
  } finally {
    // Em qualquer saída: o filho não fica vivo e o banco temporário é apagado.
    if (child !== undefined && childExit !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await withTimeout(childExit, STEP_TIMEOUT_MS, "SIGKILL do filho").catch(() => undefined);
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
