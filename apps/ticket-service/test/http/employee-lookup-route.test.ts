import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
    createFindEmployeeByEmail,
    type FindEmployeeByEmailInput,
} from "../../src/application/find-employee-by-email.js";
import { Prisma } from "../../src/generated/prisma/client.js";
import { createApp, type AppDependencies } from "../../src/http/app.js";
import { createErrorLogger } from "../../src/observability/error-log.js";
import { readPrismaCode } from "../../src/persistence/prisma-error-code.js";
import { createUnitOfWork } from "../../src/persistence/unit-of-work.js";
import { createTestDatabase } from "../support/test-database.js";

// Contrato HTTP v1.3, §10 e §11; plano da fatia 0, D8 (415 antes dos cabeçalhos). Sem
// registro operacional (cenários §1.1, IL1); o e-mail nunca chega ao log (README §12 #22).

const EMP_001 = {
    id: "EMP-001",
    name: "Funcionário de Teste 1",
    email: "emp-001@teste.example",
    department: "Testes",
    role: "EMPLOYEE",
};

const CABECALHOS_SYSTEM = { "Content-Type": "application/json", "X-Actor-Type": "SYSTEM" };

const createTicketNaoUsado: AppDependencies["createTicket"] = {
    execute: () => Promise.reject(new Error("POST /tickets não é usado nestes testes")),
};

interface ProblemDetails {
    type: string;
    title: string;
    status: number;
    code: string;
    errors?: { path: string; message: string }[];
}

describe("POST /employees/lookup", () => {
    let db: Awaited<ReturnType<typeof createTestDatabase>>;
    let unitOfWork: ReturnType<typeof createUnitOfWork>;
    // IL1: a rota não tem registro operacional; os gravadores nunca podem ser chamados.
    const registrosOperacionais: unknown[] = [];

    beforeAll(async () => {
        db = await createTestDatabase();
        unitOfWork = createUnitOfWork(db.prisma);
        await db.reset();
        await db.createEmployees("EMP-001", "ANL-001");
    });

    afterEach(() => {
        expect(registrosOperacionais).toStrictEqual([]);
        vi.restoreAllMocks();
    });

    afterAll(async () => {
        await db.dispose();
    });

    function montar(substituicoes: Partial<AppDependencies> = {}) {
        const erros: unknown[] = [];
        const app = createApp({
            createTicket: createTicketNaoUsado,
            findEmployeeByEmail: createFindEmployeeByEmail({ unitOfWork }),
            recordRead: (record) => {
                registrosOperacionais.push(record);
            },
            recordWrite: (record) => {
                registrosOperacionais.push(record);
            },
            onUnexpectedError: (error) => {
                erros.push(error);
            },
            ...substituicoes,
        });
        return { app, erros };
    }

    function post(app: ReturnType<typeof createApp>, headers: Record<string, string>, body: string) {
        return app.request("/employees/lookup", { method: "POST", headers, body });
    }

    async function problema(response: Response, status: number, code: string): Promise<ProblemDetails> {
        expect(response.status).toBe(status);
        expect(response.headers.get("content-type")?.split(";")[0]).toBe("application/problem+json");
        const corpo = (await response.json()) as ProblemDetails;
        expect(corpo).toMatchObject({ type: "about:blank", status, code });
        return corpo;
    }

    describe("200 e 404 (§10.2)", () => {
        it("200 com exatamente id, name, email, department e role", async () => {
            const { app } = montar();

            const response = await post(app, CABECALHOS_SYSTEM, JSON.stringify({ email: "emp-001@teste.example" }));

            expect(response.status).toBe(200);
            expect(response.headers.get("content-type")?.split(";")[0]).toBe("application/json");
            expect(await response.json()).toStrictEqual(EMP_001);
        });

        it("comparação normalizada: maiúsculas e espaços nas pontas encontram o funcionário (DM §3.1)", async () => {
            const { app } = montar();

            const response = await post(app, CABECALHOS_SYSTEM, JSON.stringify({ email: "  EMP-001@Teste.EXAMPLE\t" }));

            expect(response.status).toBe(200);
            expect(await response.json()).toStrictEqual(EMP_001);
        });

        it.each([
            ["e-mail inexistente", "ninguem@teste.example"],
            ["string vazia (R7)", ""],
            ["só espaços (R7)", "   "],
        ])("%s → 404 EMPLOYEE_NOT_FOUND", async (_nome, email) => {
            const { app } = montar();

            const response = await post(app, CABECALHOS_SYSTEM, JSON.stringify({ email }));

            expect(await problema(response, 404, "EMPLOYEE_NOT_FOUND")).toStrictEqual({
                type: "about:blank",
                title: "Not Found",
                status: 404,
                code: "EMPLOYEE_NOT_FOUND",
            });
        });
    });

    describe("415 antes dos cabeçalhos (D8)", () => {
        it.each<[string, Record<string, string>]>([
            ["Content-Type ausente", { "X-Actor-Type": "SYSTEM" }],
            ["Content-Type diferente", { "Content-Type": "text/plain", "X-Actor-Type": "SYSTEM" }],
            ["Content-Type errado com cabeçalho de ator inválido", { "Content-Type": "text/plain", "X-Actor-Type": "SUPERVISOR" }],
        ])("%s → 415 UNSUPPORTED_MEDIA_TYPE", async (_nome, cabecalhos) => {
            const { app } = montar();

            const response = await post(app, cabecalhos, JSON.stringify({ email: "emp-001@teste.example" }));

            await problema(response, 415, "UNSUPPORTED_MEDIA_TYPE");
        });
    });

    describe("400 VALIDATION_ERROR", () => {
        it.each<[string, Record<string, string>, string, string]>([
            ["password no corpo", CABECALHOS_SYSTEM, JSON.stringify({ email: "emp-001@teste.example", password: "x" }), "#/password"],
            ["corpo sem email", CABECALHOS_SYSTEM, JSON.stringify({}), "#/email"],
            ["JSON malformado", CABECALHOS_SYSTEM, "{", "#"],
            ["cabeçalho de ator inválido", { "Content-Type": "application/json", "X-Actor-Type": "SUPERVISOR" }, JSON.stringify({ email: "emp-001@teste.example" }), "X-Actor-Type"],
            [
                "SYSTEM com X-Actor-Employee-Id",
                { ...CABECALHOS_SYSTEM, "X-Actor-Employee-Id": "EMP-001" },
                JSON.stringify({ email: "emp-001@teste.example" }),
                "X-Actor-Employee-Id",
            ],
        ])("%s → 400 com path %s", async (_nome, cabecalhos, corpo, path) => {
            const { app } = montar();

            const response = await post(app, cabecalhos, corpo);

            const resposta = await problema(response, 400, "VALIDATION_ERROR");
            expect(resposta.errors?.map((erro) => erro.path)).toContain(path);
        });

        it("cabeçalho inválido junto com corpo inválido: só os erros de cabeçalho", async () => {
            const { app } = montar();

            const response = await post(
                app,
                { "Content-Type": "application/json", "X-Actor-Type": "SUPERVISOR" },
                JSON.stringify({ password: "x" }),
            );

            const resposta = await problema(response, 400, "VALIDATION_ERROR");
            expect(resposta.errors?.length).toBeGreaterThan(0);
            for (const erro of resposta.errors ?? []) {
                expect(erro.path.startsWith("X-Actor-")).toBe(true);
            }
        });
    });

    describe("403 ACTOR_NOT_SYSTEM depois da validação do corpo (§10.3, §11)", () => {
        it("EMPLOYEE com corpo inválido → 400, e não 403", async () => {
            const { app } = montar();

            const response = await post(
                app,
                { "Content-Type": "application/json", "X-Actor-Type": "EMPLOYEE", "X-Actor-Employee-Id": "EMP-001" },
                JSON.stringify({ password: "x" }),
            );

            await problema(response, 400, "VALIDATION_ERROR");
        });

        it.each<[string, Record<string, string>]>([
            ["EMPLOYEE", { "Content-Type": "application/json", "X-Actor-Type": "EMPLOYEE", "X-Actor-Employee-Id": "EMP-001" }],
            ["ANALYST", { "Content-Type": "application/json", "X-Actor-Type": "ANALYST", "X-Actor-Employee-Id": "ANL-001" }],
        ])("%s válido → 403 ACTOR_NOT_SYSTEM sem chamar o caso de uso", async (_nome, cabecalhos) => {
            const chamadas: FindEmployeeByEmailInput[] = [];
            const { app } = montar({
                findEmployeeByEmail: {
                    execute: (input) => {
                        chamadas.push(input);
                        return Promise.reject(new Error("o caso de uso não pode ser chamado"));
                    },
                },
            });

            const response = await post(app, cabecalhos, JSON.stringify({ email: "emp-001@teste.example" }));

            expect(await problema(response, 403, "ACTOR_NOT_SYSTEM")).toStrictEqual({
                type: "about:blank",
                title: "Forbidden",
                status: 403,
                code: "ACTOR_NOT_SYSTEM",
            });
            expect(chamadas).toStrictEqual([]);
        });
    });

    // README §12 #22: o logger composto como no main.ts (com o leitor do código do Prisma).
    it("500 com erro do Prisma plantado: corpo genérico e e-mail fora do stderr e do corpo", async () => {
        const email = "emp-001@teste.example";
        const erro = new Prisma.PrismaClientKnownRequestError(`falha ao consultar ${email}`, {
            code: "P2025",
            clientVersion: "7.10.1",
            meta: { modelName: "Employee", value: email },
        });
        Object.assign(erro, { emailConsultado: email });
        const logError = createErrorLogger(readPrismaCode);
        const { app } = montar({
            findEmployeeByEmail: { execute: () => Promise.reject(erro) },
            onUnexpectedError: (error) => logError("request", error),
        });

        // O mockRestore limpa as chamadas: a saída é lida antes de restaurar.
        const escrita = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        let response: Response;
        let stderr: string;
        try {
            response = await post(app, CABECALHOS_SYSTEM, JSON.stringify({ email }));
        } finally {
            stderr = escrita.mock.calls.map(([trecho]) => String(trecho)).join("");
            escrita.mockRestore();
        }

        const corpo = await response.text();
        expect(response.status).toBe(500);
        expect(corpo).toBe('{"type":"about:blank","title":"Internal Server Error","status":500,"code":"INTERNAL_ERROR"}');
        expect(corpo).not.toContain(email);
        expect(stderr).not.toContain(email);
        expect(stderr).toContain('"context":"request"');
        expect(stderr).toContain('"prismaCode":"P2025"');
    });
});
