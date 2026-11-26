// Smoke do web (plano do web, F2; gates R-W1, R-W2 e R-W9). Roda com `node scripts/smoke.ts`
// (remoção de tipos do Node) e só usa módulos do Node, as CLIs do Next e do Prisma e fetch para
// 127.0.0.1 (nada de src/).
// 1. next build (com a checagem de tipos do Next; R-W2).
// 2. Sem configuração, o servidor não sobe (src/instrumentation.ts).
// 3. Banco temporário migrado; next start numa porta livre, com URLs locais de teste para o
//    ticket-service e o Ollama (nenhuma chamada a eles é feita).
// 4. GET /api/health → 200: leitura real no banco (R-W1), @nexo/contracts e Agent do Mastra
//    construído no servidor do Next (R-W9).
// 5. Bundle do cliente (.next/static) sem PrismaClient, better-sqlite3 nem @mastra (ADR-013).
// 6. Encerra o servidor e confere o código de saída.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { deepStrictEqual } from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const STEP_TIMEOUT_MS = 30_000;
const BUILD_TIMEOUT_MS = 600_000;
const EXPECTED_SIGTERM_EXIT_CODE = 143;

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const nextCli = require.resolve("next/dist/bin/next");
const prismaCli = require.resolve("prisma/build/index.js");

const FORBIDDEN_IN_CLIENT_BUNDLE = ["PrismaClient", "better-sqlite3", "@mastra"];

interface ChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface RunningServer {
  process: ChildProcess;
  exited: Promise<ChildExit>;
  output: () => string;
}

const children: RunningServer[] = [];

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

// O ambiente dos filhos não herda as variáveis do web nem o DATABASE_URL do ticket-service:
// cada etapa define exatamente o que o filho recebe.
function baseEnv(): NodeJS.ProcessEnv {
  const {
    WEB_DATABASE_URL: _web,
    TICKET_SERVICE_URL: _ts,
    OLLAMA_BASE_URL: _ollama,
    DATABASE_URL: _db,
    ...inherited
  } = process.env;
  return { ...inherited, NEXT_TELEMETRY_DISABLED: "1" };
}

function run(label: string, args: string[], env: NodeJS.ProcessEnv, timeout: number): void {
  try {
    execFileSync(process.execPath, args, { cwd: webRoot, env, stdio: "pipe", timeout });
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

function startServer(port: number, env: NodeJS.ProcessEnv): RunningServer {
  const spawned = spawn(process.execPath, [nextCli, "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: webRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  spawned.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  spawned.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const exited = new Promise<ChildExit>((resolve) => {
    spawned.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const server = { process: spawned, exited, output: () => output };
  children.push(server);
  return server;
}

async function waitForHealth(baseUrl: string, server: RunningServer): Promise<Response> {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.process.exitCode !== null) {
      throw new Error(`o servidor terminou antes de responder (código ${server.process.exitCode}):\n${server.output()}`);
    }
    try {
      return await fetch(`${baseUrl}/api/health`);
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`o servidor não respondeu em ${STEP_TIMEOUT_MS} ms:\n${server.output()}`);
}

function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else files.push(path);
  }
  return files;
}

function checkClientBundle(): void {
  const staticDir = join(webRoot, ".next", "static");
  if (!existsSync(staticDir)) throw new Error(".next/static não encontrado depois do build");
  const files = listFiles(staticDir);
  const hits: string[] = [];
  for (const file of files) {
    const content = readFileSync(file, "latin1");
    for (const name of FORBIDDEN_IN_CLIENT_BUNDLE) {
      if (content.includes(name)) hits.push(`${relative(webRoot, file)}: ${name}`);
    }
  }
  if (hits.length > 0) throw new Error(`bundle do cliente com código só de servidor (ADR-013):\n${hits.join("\n")}`);
  log(`bundle do cliente sem ${FORBIDDEN_IN_CLIENT_BUNDLE.join(", ")} (${files.length} arquivos em .next/static)`);
}

async function stopServer(server: RunningServer): Promise<void> {
  server.process.kill("SIGTERM");
  const exit = await withTimeout(server.exited, STEP_TIMEOUT_MS, "encerramento do servidor");
  if (process.platform === "win32") {
    // No Windows o kill("SIGTERM") termina o processo sem passar pelo handler de sinal.
    log(`servidor terminado (código ${exit.code}, sinal ${exit.signal})`);
    log("AVISO: encerramento ordenado não verificável no Windows (SIGTERM mata o processo); verificado na CI (Linux)");
    return;
  }
  // O next start 16.4.6 trata o SIGTERM com um handler de limpeza e sai com 143 (128 + 15;
  // next/dist/server/lib/start-server.js). Código 143 sem sinal = encerramento pelo handler.
  if (exit.code !== EXPECTED_SIGTERM_EXIT_CODE || exit.signal !== null) {
    throw new Error(
      `encerramento: esperado código ${EXPECTED_SIGTERM_EXIT_CODE} e sinal null, recebido código ${exit.code}, sinal ${exit.signal}:\n${server.output()}`,
    );
  }
  log(`servidor encerrado pelo handler de SIGTERM do Next (código ${exit.code})`);
}

async function smoke(): Promise<void> {
  let tempDir: string | undefined;
  try {
    log("next build");
    run("next build", [nextCli, "build"], baseEnv(), BUILD_TIMEOUT_MS);

    log("sem configuração: o servidor não pode subir");
    const unconfigured = startServer(await freePort(), baseEnv());
    const refused = await withTimeout(unconfigured.exited, STEP_TIMEOUT_MS, "servidor sem configuração");
    if (refused.code !== 1 || !unconfigured.output().includes("WEB_DATABASE_URL é obrigatória")) {
      throw new Error(`sem configuração, esperado código 1 e a mensagem de configuração:\n${unconfigured.output()}`);
    }
    log("sem configuração: recusado com código 1");

    tempDir = mkdtempSync(join(tmpdir(), "nexo-web-smoke-"));
    const databaseUrl = `file:${join(tempDir, "web.db").replaceAll("\\", "/")}`;
    log(`aplicando migrações em ${databaseUrl}`);
    run("prisma migrate deploy", [prismaCli, "migrate", "deploy"], { ...baseEnv(), WEB_DATABASE_URL: databaseUrl }, STEP_TIMEOUT_MS * 3);

    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    log(`next start em ${baseUrl}`);
    const server = startServer(port, {
      ...baseEnv(),
      WEB_DATABASE_URL: databaseUrl,
      // URLs locais de teste: nenhuma chamada é feita a elas.
      TICKET_SERVICE_URL: `http://127.0.0.1:${await freePort()}`,
      OLLAMA_BASE_URL: `http://127.0.0.1:${await freePort()}/v1`,
    });

    const response = await waitForHealth(baseUrl, server);
    const body: unknown = await response.json();
    if (response.status !== 200) throw new Error(`GET /api/health: esperado 200, recebido ${response.status}: ${JSON.stringify(body)}`);
    deepStrictEqual(body, { db: "ok", contracts: { ticketTypes: 2 }, agent: "loaded" });
    log(`GET /api/health → 200 ${JSON.stringify(body)}`);

    // F4: a página de login responde, e a inicial sem sessão redireciona para ela.
    const login = await fetch(`${baseUrl}/login`);
    if (login.status !== 200) throw new Error(`GET /login: esperado 200, recebido ${login.status}`);
    const home = await fetch(`${baseUrl}/`, { redirect: "manual" });
    const location = home.headers.get("location") ?? "";
    if (home.status < 300 || home.status >= 400 || new URL(location, baseUrl).pathname !== "/login") {
      throw new Error(`GET / sem sessão: esperado redirecionamento para /login, recebido ${home.status} ${location}`);
    }
    log(`GET /login → 200; GET / sem sessão → ${home.status} para /login`);

    checkClientBundle();
    await stopServer(server);
    log("OK");
  } finally {
    for (const child of children) {
      if (child.process.exitCode === null && child.process.signalCode === null) {
        child.process.kill("SIGKILL");
        await withTimeout(child.exited, STEP_TIMEOUT_MS, "SIGKILL do filho").catch(() => undefined);
      }
    }
    if (tempDir !== undefined) {
      rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

smoke().catch((error: unknown) => {
  console.error("[smoke] FALHOU:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
