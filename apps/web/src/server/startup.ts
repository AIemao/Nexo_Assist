import { formatConfigErrors, readConfig } from "./config";

// Chamado pela instrumentation do Next, só no runtime nodejs: sem configuração válida, o servidor
// nem sobe (mesmo comportamento do ticket-service, apps/ticket-service/src/main.ts).
export function assertStartupConfig(): void {
  const result = readConfig(process.env);
  if (!result.ok) {
    console.error(formatConfigErrors(result.errors));
    process.exit(1);
  }
}
