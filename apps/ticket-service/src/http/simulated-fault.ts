// Falhas simuladas do ticket-service (docs/evaluation/01-evaluation-scenarios.md §2.2).
// Cada modo entra com o seu teste: um modo aceito pelo tipo e não implementado
// seria ignorado em silêncio. A validação de delayMs (inteiro positivo) é da leitura
// da configuração (FS1); aqui o tipo só exige o campo.
export type SimulatedFault =
  | { mode: "F-DROP-BEFORE" }
  | { mode: "F-DROP-AFTER" }
  | { mode: "F-SLOW"; delayMs: number };
