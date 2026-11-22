// Roda a CLI do Next com a telemetria desligada (NEXT_TELEMETRY_DISABLED=1), para não haver
// chamada externa, em qualquer sistema (o npm usa o cmd no Windows, que não aceita VAR=x cmd).
// Uso: node scripts/next.ts <dev|build|start> [argumentos do Next].
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const nextCli = createRequire(import.meta.url).resolve("next/dist/bin/next");

const child = spawn(process.execPath, [nextCli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}

// Encerrado por sinal (code null) conta como falha.
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
