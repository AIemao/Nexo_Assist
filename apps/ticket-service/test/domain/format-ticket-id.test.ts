
import { describe, expect, it } from "vitest";
import { formatTicketId } from "../../src/domain/format-ticket-id.js";

describe("formatTicketId", () => {
    it.each([
        { type: "INC", number: 1, expected: "INC-1" },
        { type: "REQ", number: 1, expected: "REQ-1" },
        { type: "INC", number: 20311, expected: "INC-20311" },
        { type: "REQ", number: 10442, expected: "REQ-10442" },
    ] as const)(
        "formata $type com o número $number",
        ({ type, number, expected }) => {
            expect(formatTicketId(type, number)).toBe(expected);
        },
    );

    it.each([
        { number: 0, description: "zero" },
        { number: -1, description: "número negativo" },
        { number: 1.5, description: "número fracionário" },
        { number: Number.NaN, description: "NaN" },
        {
            number: Number.MAX_SAFE_INTEGER + 1,
            description: "inteiro fora da faixa segura",
        },
    ])("rejeita $description", ({ number }) => {
        expect(() => formatTicketId("INC", number)).toThrow(RangeError);
    });
});
