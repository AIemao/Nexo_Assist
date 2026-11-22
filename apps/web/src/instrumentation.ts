// Inicialização do servidor do Next. A verificação usa APIs do Node e só roda no runtime nodejs.
export async function register(): Promise<void> {
  if (process.env["NEXT_RUNTIME"] === "nodejs") {
    const { assertStartupConfig } = await import("./server/startup");
    assertStartupConfig();
  }
}
