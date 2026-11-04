import { describe, expect, it } from "vitest";

import { findDuplicateCandidates } from "../../src/domain/duplicate-candidates.js";

import type { DuplicateCandidateTicket } from "../../src/domain/index.js";

const EMP_A = "EMP-A";
const criteria = { type: "INC", category: "HARDWARE" } as const;
const nenhumDescartado: ReadonlySet<string> = new Set();

function ticket(
    overrides: Partial<DuplicateCandidateTicket> & { id: string },
): DuplicateCandidateTicket {
    return {
        requesterId: EMP_A,
        type: "INC",
        category: "HARDWARE",
        status: "WAITING_ANALYST",
        updatedAt: "2026-11-01T12:00:00.000Z",
        ...overrides,
    };
}

const ids = (lista: readonly DuplicateCandidateTicket[]) =>
    lista.map((t) => t.id);

describe("findDuplicateCandidates", () => {
    it("devolve chamado aberto do mesmo solicitante, tipo e categoria", () => {
        const tickets = [ticket({ id: "INC-1" })];

        expect(
            ids(findDuplicateCandidates(EMP_A, criteria, tickets, nenhumDescartado)),
        ).toEqual(["INC-1"]);
    });

    it("não devolve chamado de outro solicitante", () => {
        const tickets = [ticket({ id: "INC-B", requesterId: "EMP-B" })];

        expect(
            ids(findDuplicateCandidates(EMP_A, criteria, tickets, nenhumDescartado)),
        ).toEqual([]);
    });

    it("não devolve chamado de tipo diferente", () => {
        const tickets = [ticket({ id: "REQ-1", type: "REQ" })];

        expect(
            ids(findDuplicateCandidates(EMP_A, criteria, tickets, nenhumDescartado)),
        ).toEqual([]);
    });

    it("não devolve chamado de categoria diferente", () => {
        const tickets = [ticket({ id: "INC-1", category: "SOFTWARE" })];

        expect(
            ids(findDuplicateCandidates(EMP_A, criteria, tickets, nenhumDescartado)),
        ).toEqual([]);
    });

    it("não devolve chamado com status RESOLVED", () => {
        const tickets = [ticket({ id: "INC-1", status: "RESOLVED" })];

        expect(
            ids(findDuplicateCandidates(EMP_A, criteria, tickets, nenhumDescartado)),
        ).toEqual([]);
    });

    it("devolve chamado APPROVED quando tipo e categoria correspondem ao critério", () => {
        const reqCriteria = { type: "REQ", category: "HARDWARE" } as const;
        const tickets = [
            ticket({
                id: "REQ-1",
                type: "REQ",
                status: "APPROVED",
            }),
        ];

        expect(
            ids(findDuplicateCandidates(EMP_A, reqCriteria, tickets, nenhumDescartado)),
        ).toEqual(["REQ-1"]);
    });

    it("não devolve IDs presentes em dismissedIds", () => {
        const tickets = [
            ticket({ id: "INC-1" }),
            ticket({ id: "INC-2" }),
        ];
        const dismissedIds = new Set(["INC-1"]);

        expect(
            ids(findDuplicateCandidates(EMP_A, criteria, tickets, dismissedIds)),
        ).toEqual(["INC-2"]);
    });

    it("devolve lista vazia quando não existem chamados", () => {
        expect(
            findDuplicateCandidates(EMP_A, criteria, [], nenhumDescartado),
        ).toEqual([]);
    });

    it("ordena por updatedAt mais recente primeiro", () => {
        const tickets = [
            ticket({ id: "INC-1", updatedAt: "2026-11-01T10:00:00.000Z" }),
            ticket({ id: "INC-2", updatedAt: "2026-11-01T14:00:00.000Z" }),
            ticket({ id: "INC-3", updatedAt: "2026-11-01T12:00:00.000Z" }),
        ];

        expect(
            ids(findDuplicateCandidates(EMP_A, criteria, tickets, nenhumDescartado)),
        ).toEqual(["INC-2", "INC-3", "INC-1"]);
    });

    it("desempata por ID crescente quando updatedAt representa o mesmo instante", () => {
        const tickets = [
            ticket({ id: "INC-2", updatedAt: "2026-11-04T12:00:00.000Z" }),
            ticket({ id: "INC-1", updatedAt: "2026-11-04T09:00:00.000-03:00" }),
        ];

        expect(
            ids(findDuplicateCandidates(EMP_A, criteria, tickets, nenhumDescartado)),
        ).toEqual(["INC-1", "INC-2"]);
    });

    it("ordena por instante real, considerando offsets diferentes", () => {
        const tickets = [
            ticket({ id: "INC-1", updatedAt: "2026-11-04T11:00:00.000Z" }),
            ticket({ id: "INC-2", updatedAt: "2026-11-04T09:00:00.000-03:00" }),
            ticket({ id: "INC-3", updatedAt: "2026-11-04T12:01:00.000Z" }),
        ];

        expect(
            ids(findDuplicateCandidates(EMP_A, criteria, tickets, nenhumDescartado)),
        ).toEqual(["INC-3", "INC-2", "INC-1"]);
    });

    it("não modifica o array recebido", () => {
        const tickets = [
            ticket({ id: "INC-1", updatedAt: "2026-11-01T10:00:00.000Z" }),
            ticket({ id: "INC-3", updatedAt: "2026-11-01T14:00:00.000Z" }),
            ticket({ id: "INC-2", updatedAt: "2026-11-01T12:00:00.000Z" }),
        ];
        const antes = [...tickets];

        findDuplicateCandidates(EMP_A, criteria, tickets, nenhumDescartado);

        expect(tickets).toEqual(antes);
    });
});