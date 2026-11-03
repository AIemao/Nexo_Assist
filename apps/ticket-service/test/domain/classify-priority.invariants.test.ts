import { describe, expect, it } from "vitest";

import { classifyPriority } from "../../src/domain/classify-priority.js";

import type {
    AffectedScope,
    CommitmentRisk,
    ImpactAssessmentDraft,
    PriorityClassification,
    WorkImpact,
} from "../../src/domain/index.js";

const AUSENTE = "ausente";
type Ausente = typeof AUSENTE;

const impactos: (WorkImpact | Ausente)[] = [
    "BLOCKED",
    "DEGRADED_WITH_WORKAROUND",
    "NONE",
    AUSENTE,
];
const alcances: (AffectedScope | Ausente)[] = [
    "SELF",
    "TEAM",
    "COMPANY",
    "UNKNOWN",
    AUSENTE,
];
const riscos: (CommitmentRisk | Ausente)[] = [
    "YES",
    "NO",
    "UNKNOWN",
    "NOT_ASKED",
    AUSENTE,
];

interface Combinacao {
    rotulo: string;
    impacto: WorkImpact | Ausente;
    alcance: AffectedScope | Ausente;
    risco: CommitmentRisk | Ausente;
    entrada: ImpactAssessmentDraft;
}

// "Ausente" = chave não presente no objeto (não é undefined como valor).
function montar(
    impacto: WorkImpact | Ausente,
    alcance: AffectedScope | Ausente,
    risco: CommitmentRisk | Ausente,
): Combinacao {
    const entrada: ImpactAssessmentDraft = {};
    if (impacto !== AUSENTE) entrada.workImpact = impacto;
    if (alcance !== AUSENTE) entrada.affectedScope = alcance;
    if (risco !== AUSENTE) entrada.commitmentRisk = risco;
    return {
        rotulo: JSON.stringify(entrada),
        impacto,
        alcance,
        risco,
        entrada,
    };
}

const combinacoes: Combinacao[] = impactos.flatMap((i) =>
    alcances.flatMap((a) => riscos.map((r) => montar(i, a, r))),
);

// Devolve a descrição das combinações que violam o predicado (lista vazia = ok).
function violacoes(
    verifica: (c: Combinacao, r: PriorityClassification) => boolean,
    universo: Combinacao[] = combinacoes,
): string[] {
    return universo
        .filter((c) => !verifica(c, classifyPriority(c.entrada)))
        .map((c) => c.rotulo);
}

// Agrupa as combinações pelas chaves informadas; cada grupo deve ter um único resultado.
function gruposComResultadosDiferentes(
    universo: Combinacao[],
    chave: (c: Combinacao) => string,
): string[] {
    const grupos = new Map<string, Combinacao[]>();
    for (const c of universo) {
        const k = chave(c);
        grupos.set(k, [...(grupos.get(k) ?? []), c]);
    }
    return [...grupos.entries()]
        .filter(([, membros]) => {
            const resultados = new Set(
                membros.map((m) => JSON.stringify(classifyPriority(m.entrada))),
            );
            return resultados.size > 1;
        })
        .map(([k, membros]) => `${k}: ${membros.map((m) => m.rotulo).join(" | ")}`);
}

const campoPorMotivo = {
    WORK_IMPACT: "WORK_IMPACT_MISSING",
    AFFECTED_SCOPE: "AFFECTED_SCOPE_MISSING",
    COMMITMENT_RISK: "COMMITMENT_RISK_MISSING",
} as const;

describe("classifyPriority — invariantes sobre as 100 combinações", () => {
    it("gera 100 combinações", () => {
        expect(combinacoes).toHaveLength(100);
    });

    it("1. total: não lança e devolve CLASSIFIED ou NEEDS_CLARIFICATION", () => {
        const lancou: string[] = [];
        const invalidas: string[] = [];
        for (const c of combinacoes) {
            try {
                const r = classifyPriority(c.entrada);
                if (r.status !== "CLASSIFIED" && r.status !== "NEEDS_CLARIFICATION") {
                    invalidas.push(c.rotulo);
                }
            } catch {
                lancou.push(c.rotulo);
            }
        }
        expect({ lancou, invalidas }).toEqual({ lancou: [], invalidas: [] });
    });

    it("2. forma do resultado: CLASSIFIED tem priority e não tem missingFields; NEEDS_CLARIFICATION tem 1 missingField e não tem priority", () => {
        expect(
            violacoes((_c, r) =>
                r.status === "CLASSIFIED"
                    ? "priority" in r && !("missingFields" in r)
                    : !("priority" in r) && r.missingFields.length === 1,
            ),
        ).toEqual([]);
    });

    it("3. missingFields corresponde ao reasonCode", () => {
        expect(
            violacoes(
                (_c, r) =>
                    r.status === "NEEDS_CLARIFICATION" &&
                    campoPorMotivo[r.missingFields[0] as keyof typeof campoPorMotivo] ===
                        r.reasonCode,
                combinacoes.filter(
                    (c) => classifyPriority(c.entrada).status === "NEEDS_CLARIFICATION",
                ),
            ),
        ).toEqual([]);
    });

    it("4. workImpact ausente pede WORK_IMPACT, qualquer que seja o resto", () => {
        expect(
            violacoes(
                (_c, r) =>
                    r.status === "NEEDS_CLARIFICATION" &&
                    r.missingFields.length === 1 &&
                    r.missingFields[0] === "WORK_IMPACT",
                combinacoes.filter((c) => c.impacto === AUSENTE),
            ),
        ).toEqual([]);
    });

    it("5. BLOCKED com alcance presente é CLASSIFIED e não depende de commitmentRisk", () => {
        const universo = combinacoes.filter(
            (c) => c.impacto === "BLOCKED" && c.alcance !== AUSENTE,
        );
        expect(violacoes((_c, r) => r.status === "CLASSIFIED", universo)).toEqual([]);
        expect(gruposComResultadosDiferentes(universo, (c) => c.alcance)).toEqual([]);
    });

    it("6. CRITICAL ocorre se e somente se BLOCKED + (TEAM ou COMPANY)", () => {
        expect(
            violacoes((c, r) => {
                const critica = r.status === "CLASSIFIED" && r.priority === "CRITICAL";
                const esperada =
                    c.impacto === "BLOCKED" &&
                    (c.alcance === "TEAM" || c.alcance === "COMPANY");
                return critica === esperada;
            }),
        ).toEqual([]);
    });

    it("7. fora de BLOCKED, affectedScope não altera o resultado", () => {
        const universo = combinacoes.filter(
            (c) => c.impacto !== "BLOCKED" && c.impacto !== AUSENTE,
        );
        expect(
            gruposComResultadosDiferentes(universo, (c) => `${c.impacto}/${c.risco}`),
        ).toEqual([]);
    });

    it("8. determinismo: duas chamadas com a mesma entrada dão resultados iguais", () => {
        expect(
            violacoes(
                (c, r) => JSON.stringify(classifyPriority(c.entrada)) === JSON.stringify(r),
            ),
        ).toEqual([]);
    });
});
