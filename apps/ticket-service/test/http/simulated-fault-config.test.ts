import { describe, expect, it } from "vitest";
import { readSimulatedFault, type SimulatedFault } from "../../src/http/simulated-fault.js";

// Cenários §2.2, FS1. Valores exatos: sem trim, sem caixa alternativa, sem zero à esquerda.
// /SIMULATED_FAULT\b/ não casa dentro de "SIMULATED_FAULT_DELAY_MS" ("_" é caractere de palavra).
const VARIAVEL_MODO = /SIMULATED_FAULT\b/;
const VARIAVEL_ATRASO = /SIMULATED_FAULT_DELAY_MS/;

type Env = Record<string, string | undefined>;

describe("readSimulatedFault", () => {
    it.each<{ nome: string; env: Env }>([
        { nome: "SIMULATED_FAULT ausente", env: {} },
        { nome: "SIMULATED_FAULT vazia", env: { SIMULATED_FAULT: "" } },
        { nome: "as duas variáveis vazias", env: { SIMULATED_FAULT: "", SIMULATED_FAULT_DELAY_MS: "" } },
    ])("desligada: $nome", ({ env }) => {
        expect(readSimulatedFault(env)).toStrictEqual({ ok: true, fault: undefined });
    });

    it.each<{ nome: string; env: Env; fault: SimulatedFault }>([
        {
            nome: "F-DROP-BEFORE",
            env: { SIMULATED_FAULT: "F-DROP-BEFORE" },
            fault: { mode: "F-DROP-BEFORE" },
        },
        {
            nome: "F-DROP-AFTER",
            env: { SIMULATED_FAULT: "F-DROP-AFTER" },
            fault: { mode: "F-DROP-AFTER" },
        },
        {
            nome: "F-SLOW com 1 (limite inferior)",
            env: { SIMULATED_FAULT: "F-SLOW", SIMULATED_FAULT_DELAY_MS: "1" },
            fault: { mode: "F-SLOW", delayMs: 1 },
        },
        {
            nome: "F-SLOW com 500",
            env: { SIMULATED_FAULT: "F-SLOW", SIMULATED_FAULT_DELAY_MS: "500" },
            fault: { mode: "F-SLOW", delayMs: 500 },
        },
        {
            nome: "F-SLOW no teto do setTimeout (2147483647)",
            env: { SIMULATED_FAULT: "F-SLOW", SIMULATED_FAULT_DELAY_MS: "2147483647" },
            fault: { mode: "F-SLOW", delayMs: 2_147_483_647 },
        },
    ])("válida: $nome", ({ env, fault }) => {
        expect(readSimulatedFault(env)).toStrictEqual({ ok: true, fault });
    });

    it.each<{ nome: string; env: Env; mensagem: RegExp[] }>([
        {
            nome: "modo desconhecido",
            env: { SIMULATED_FAULT: "F-SPIKE" },
            mensagem: [VARIAVEL_MODO, /F-SPIKE/, /F-DROP-BEFORE/, /F-DROP-AFTER/, /F-SLOW/],
        },
        {
            nome: "modo em minúsculas (f-slow)",
            env: { SIMULATED_FAULT: "f-slow", SIMULATED_FAULT_DELAY_MS: "500" },
            mensagem: [VARIAVEL_MODO, /f-slow/],
        },
        {
            nome: "F-SLOW sem atraso",
            env: { SIMULATED_FAULT: "F-SLOW" },
            mensagem: [VARIAVEL_ATRASO],
        },
        {
            nome: "F-SLOW com atraso vazio",
            env: { SIMULATED_FAULT: "F-SLOW", SIMULATED_FAULT_DELAY_MS: "" },
            mensagem: [VARIAVEL_ATRASO],
        },
        ...["0", "-1", "1.5", "abc", "500ms", " 500", "500 ", "0500", "+500", "1e3", "0x1F4", "2147483648"].map((atraso) => ({
            nome: `F-SLOW com atraso ${JSON.stringify(atraso)}`,
            env: { SIMULATED_FAULT: "F-SLOW", SIMULATED_FAULT_DELAY_MS: atraso },
            mensagem: [VARIAVEL_ATRASO],
        })),
        {
            nome: "atraso com F-DROP-BEFORE",
            env: { SIMULATED_FAULT: "F-DROP-BEFORE", SIMULATED_FAULT_DELAY_MS: "500" },
            mensagem: [VARIAVEL_ATRASO],
        },
        {
            nome: "atraso com F-DROP-AFTER",
            env: { SIMULATED_FAULT: "F-DROP-AFTER", SIMULATED_FAULT_DELAY_MS: "500" },
            mensagem: [VARIAVEL_ATRASO],
        },
        {
            nome: "atraso sem modo (SIMULATED_FAULT ausente)",
            env: { SIMULATED_FAULT_DELAY_MS: "500" },
            mensagem: [VARIAVEL_ATRASO],
        },
        {
            nome: "atraso sem modo (SIMULATED_FAULT vazia)",
            env: { SIMULATED_FAULT: "", SIMULATED_FAULT_DELAY_MS: "500" },
            mensagem: [VARIAVEL_ATRASO],
        },
    ])("inválida: $nome", ({ env, mensagem }) => {
        const resultado = readSimulatedFault(env);

        for (const trecho of mensagem) {
            expect(resultado).toStrictEqual({ ok: false, message: expect.stringMatching(trecho) });
        }
    });
});
