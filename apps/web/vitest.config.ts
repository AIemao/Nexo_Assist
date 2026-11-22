import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/support/global-setup.ts"],
    // Plano G1: nenhum teste do web sai da máquina (sem Ollama nem rede, cenários §1).
    setupFiles: ["test/support/network-guard.ts"],
    env: { NEXT_TELEMETRY_DISABLED: "1" },
  },
});
