import { describe, expect, it } from "vitest";

describe("bloqueio de rede nos testes (plano G1)", () => {
  it("recusa fetch para o Ollama em localhost:11434", async () => {
    await expect(fetch("http://localhost:11434/api/tags")).rejects.toThrow(/rede bloqueada nos testes/);
  });

  it("recusa fetch para fora da máquina", async () => {
    await expect(fetch("https://example.com/")).rejects.toThrow(/rede bloqueada nos testes/);
  });
});
