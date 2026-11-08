// Falhas simuladas do ticket-service (docs/evaluation/01-evaluation-scenarios.md §2.2).
// Cada modo entra com o seu teste: um modo aceito pelo tipo e não implementado
// seria ignorado em silêncio.
export type SimulatedFault =
  | { mode: "F-DROP-BEFORE" }
  | { mode: "F-DROP-AFTER" }
  | { mode: "F-SLOW"; delayMs: number };

export type SimulatedFaultConfig =
  | { ok: true; fault: SimulatedFault | undefined }
  | { ok: false; message: string };

const SIMULATED_FAULT_MODES = ["F-DROP-BEFORE", "F-DROP-AFTER", "F-SLOW"] as const satisfies readonly SimulatedFault["mode"][];

// Teto do setTimeout (2^31 − 1 ms). Acima dele o Node troca a espera por 1 ms e só emite
// um aviso: um F-SLOW maior pareceria funcionar sem atrasar nada.
const MAX_DELAY_MS = 2_147_483_647;

// Só algarismos, sem zero à esquerda. Testado antes de qualquer conversão: Number()
// aceitaria "+500", "1e3", "0x1F4" e " 500".
const DELAY_PATTERN = /^[1-9][0-9]*$/;

// FS1: lê a configuração da falha simulada. Função pura: recebe o env por parâmetro.
export function readSimulatedFault(env: Record<string, string | undefined>): SimulatedFaultConfig {
  // Vazio equivale a ausente nas duas variáveis. É exceção destas variáveis (no readConfig
  // do main.ts, vazio é erro): a configuração é opcional e desligada por padrão, e uma linha
  // "SIMULATED_FAULT=" num .env não impede o serviço de subir. Só espaços não é vazio.
  const mode = presentValue(env["SIMULATED_FAULT"]);
  const delay = presentValue(env["SIMULATED_FAULT_DELAY_MS"]);

  // (a) Sem modo: desligada, salvo atraso órfão.
  if (mode === undefined) {
    if (delay !== undefined) {
      return invalid(`SIMULATED_FAULT_DELAY_MS definida (${JSON.stringify(delay)}) sem SIMULATED_FAULT=F-SLOW.`);
    }
    return { ok: true, fault: undefined };
  }

  // (b) Modo avaliado antes do atraso; comparação exata.
  if (!isSimulatedFaultMode(mode)) {
    return invalid(
      `SIMULATED_FAULT inválida: ${JSON.stringify(mode)}. Valores aceitos: ${SIMULATED_FAULT_MODES.join(", ")}.`,
    );
  }

  // (c) F-SLOW exige atraso válido.
  if (mode === "F-SLOW") {
    if (delay === undefined) {
      return invalid("SIMULATED_FAULT_DELAY_MS é obrigatória com SIMULATED_FAULT=F-SLOW.");
    }
    if (!DELAY_PATTERN.test(delay) || Number(delay) > MAX_DELAY_MS) {
      return invalid(
        `SIMULATED_FAULT_DELAY_MS inválida: ${JSON.stringify(delay)}. Use um inteiro de 1 a ${MAX_DELAY_MS}, só algarismos.`,
      );
    }
    return { ok: true, fault: { mode, delayMs: Number(delay) } };
  }

  // (d) Atraso com outro modo: ninguém o aplicaria.
  if (delay !== undefined) {
    return invalid(`SIMULATED_FAULT_DELAY_MS (${JSON.stringify(delay)}) só vale com SIMULATED_FAULT=F-SLOW, não com ${mode}.`);
  }
  return { ok: true, fault: { mode } };
}

function presentValue(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

function isSimulatedFaultMode(value: string): value is SimulatedFault["mode"] {
  return SIMULATED_FAULT_MODES.some((mode) => mode === value);
}

function invalid(message: string): SimulatedFaultConfig {
  return { ok: false, message };
}
