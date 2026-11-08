// Falhas simuladas do ticket-service (docs/evaluation/01-evaluation-scenarios.md §2.2).
// Cada modo entra com o seu teste: um modo aceito pelo tipo e não implementado
// seria ignorado em silêncio. Por ora, F-DROP-BEFORE (FS2) e F-DROP-AFTER (FS3).
export type SimulatedFault = { mode: "F-DROP-BEFORE" } | { mode: "F-DROP-AFTER" };
