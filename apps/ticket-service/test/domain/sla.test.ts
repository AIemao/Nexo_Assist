
import { describe, expect, it } from "vitest";

import { computeDueAt, isOverdue } from "../../src/domain/sla.js";

import type { Priority } from "../../src/domain/index.js";

type Caso = [nome: string, start: string, priority: Priority, esperado: string];

const casos: Caso[] = [
    // Casos-modelo:
    ["Alta, segunda 10:00 + 4 h úteis", "2026-11-02T10:00:00.000-03:00", "HIGH", "2026-11-02T17:00:00.000Z"],
    ["Crítica, domingo 03:00 + 1 h corrida", "2026-11-08T03:00:00.000-03:00", "CRITICAL", "2026-11-08T07:00:00.000Z"],

    // Alta:
    ["Alta, sexta 17:00", "2026-11-06T17:00:00.000-03:00", "HIGH", "2026-11-09T14:00:00.000Z"],
    ["Alta, termina exatamente às 18:00", "2026-11-02T14:00:00.000-03:00", "HIGH", "2026-11-02T21:00:00.000Z"],
    ["Alta, início 07:59 (antes da abertura)", "2026-11-02T07:59:00.000-03:00", "HIGH", "2026-11-02T15:00:00.000Z"],
    ["Alta, início 18:00 em ponto", "2026-11-02T18:00:00.000-03:00", "HIGH", "2026-11-03T15:00:00.000Z"],
    ["Alta, início no sábado", "2026-11-07T15:00:00.000-03:00", "HIGH", "2026-11-09T15:00:00.000Z"],

    // Média:
    ["Média, terça 17:00", "2026-11-03T17:00:00.000-03:00", "MEDIUM", "2026-11-06T20:00:00.000Z"],
    ["Média, segunda 08:00 em ponto", "2026-11-02T08:00:00.000-03:00", "MEDIUM", "2026-11-04T21:00:00.000Z"],

    // Baixa:
    ["Baixa, sexta 17:00", "2026-11-06T17:00:00.000-03:00", "LOW", "2026-11-13T20:00:00.000Z"],

    // Crítica:
    ["Crítica, sexta 17:30 (ignora a janela)", "2026-11-06T17:30:00.000-03:00", "CRITICAL", "2026-11-06T21:30:00.000Z"],
    ["Crítica, domingo 23:30 (vira o dia)", "2026-11-08T23:30:00.000-03:00", "CRITICAL", "2026-11-09T03:30:00.000Z"],

    // Travessia de mês:
    ["Média, virada de mês, sexta 15:00", "2026-10-30T15:00:00.000-03:00", "MEDIUM", "2026-11-04T18:00:00.000Z"],

    // Travessia de ano:
    // 01/01/2027 é tratado como dia útil: feriados estão fora do MVP.
    ["Alta, virada de ano, quinta 16:00", "2026-12-31T16:00:00.000-03:00", "HIGH", "2027-01-01T13:00:00.000Z"],

    // Mesmo instante representado em outro fuso:
    ["Fuso: mesmo início do primeiro modelo, em UTC", "2026-11-02T13:00:00.000Z", "HIGH", "2026-11-02T17:00:00.000Z"],

    // 01:00 UTC de terça = 22:00 local de segunda.
    // A próxima abertura é terça às 08:00 local.
    ["Fuso traiçoeiro, Alta", "2026-11-03T01:00:00.000Z", "HIGH", "2026-11-03T15:00:00.000Z"],
];

describe("computeDueAt", () => {
    it.each(casos)("%s", (_nome, start, priority, esperado) => {
        expect(computeDueAt(start, priority)).toBe(esperado);
    });
});

describe("isOverdue", () => {
    const dueAt = "2026-11-02T17:00:00.000Z";

    const casosOverdue = [
        ["1 ms antes do prazo", "2026-11-02T16:59:59.999Z", false],
        ["exatamente no prazo", "2026-11-02T17:00:00.000Z", false],
        ["1 ms depois do prazo", "2026-11-02T17:00:00.001Z", true],
        ["mesmo instante, escrito em -03:00", "2026-11-02T14:00:00.000-03:00", false],
    ] as const;

    it.each(casosOverdue)("%s", (_nome, now, esperado) => {
        expect(isOverdue(dueAt, now)).toBe(esperado);
    });
});
