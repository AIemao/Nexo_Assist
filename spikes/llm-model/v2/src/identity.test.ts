// Identidade com a V1 (v2/CRITERIA.md, "Relação com a V1", "Configuração", "Prompt da V2",
// "Reutilização da V1"): arquivos compartilhados, constantes, prompt e importação sem efeito.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { PROMPT_VERSION as V1_PROMPT_VERSION, SYSTEM_PROMPT as V1_PROMPT } from "../../src/prompt.ts";
import { PROMPT_VERSION, SUBMIT_DESCRIPTION, SYSTEM_PROMPT } from "./prompt.ts";
import { REASONING_KEY } from "./leak.ts";
import { MAX_ATTEMPTS, MAX_STEPS, TURN_TIMEOUT_MS, verifyManifest } from "./run.ts";

const SPIKE = new URL("../../", import.meta.url);
const V1_COMMIT = "2182d6b";
const sha256 = (path: string) => createHash("sha256").update(readFileSync(new URL(path, SPIKE))).digest("hex");
const v2Criteria = readFileSync(new URL("../CRITERIA.md", import.meta.url), "utf8");

describe("arquivos compartilhados com a V1", () => {
  it("SHA-256 iguais aos do manifesto congelado da V1 (CRITERIA.md da V1)", () => {
    const v1Criteria = readFileSync(new URL("CRITERIA.md", SPIKE), "utf8");
    const rows = [...v1Criteria.matchAll(/\| `([^`]+)` \| `([0-9a-f]{64})` \|/g)];
    assert.equal(rows.length, 11);
    for (const [, file = "", expected = ""] of rows) assert.equal(sha256(file), expected, file);
  });

  it(`módulos da V1 reutilizados e fora do manifesto da V1: idênticos ao commit ${V1_COMMIT}`, () => {
    for (const file of ["src/run.ts", "src/run-record.ts", "src/score.ts"]) {
      const committed = execFileSync("git", ["show", `${V1_COMMIT}:spikes/llm-model/${file}`], { cwd: fileURLToPath(SPIKE) });
      assert.equal(createHash("sha256").update(committed).digest("hex"), sha256(file), file);
    }
  });
});

describe("configuração", () => {
  it("maxSteps, tempo limite e tentativas iguais aos do código da V1 (não exportados por ela)", () => {
    const v1 = readFileSync(new URL("src/run.ts", SPIKE), "utf8");
    const constant = (name: string) => Number(new RegExp(`const ${name} = ([0-9_]+);`).exec(v1)?.[1]?.replaceAll("_", ""));
    assert.equal(constant("MAX_STEPS"), MAX_STEPS);
    assert.equal(constant("TURN_TIMEOUT_MS"), TURN_TIMEOUT_MS);
    assert.equal(constant("MAX_ATTEMPTS"), MAX_ATTEMPTS);
  });

  it("REASONING_KEY da V2 (leak.ts) igual ao da V1 (não exportado por ela): padrão e flags", () => {
    const v1 = readFileSync(new URL("src/run.ts", SPIKE), "utf8");
    const literal = /^const REASONING_KEY = \/(.+)\/([a-z]*);$/m.exec(v1);
    assert.ok(literal, "literal do REASONING_KEY não encontrado no src/run.ts da V1");
    const v1Key = new RegExp(literal[1] as string, literal[2]);
    assert.equal(REASONING_KEY.source, v1Key.source, "padrão");
    assert.equal(REASONING_KEY.flags, v1Key.flags, "flags");
    assert.equal(REASONING_KEY.flags, "i");
  });
});

describe("prompt da V2", () => {
  it("é o da V1 com exatamente uma linha do texto trocada (a L30), mais a versão", () => {
    const v1 = V1_PROMPT.split("\n");
    const v2 = SYSTEM_PROMPT.split("\n");
    assert.equal(v2.length, v1.length);
    const changed = v1.flatMap((line, i) => (line === v2[i] ? [] : [i]));
    assert.equal(changed.length, 1, `linhas diferentes: ${changed.join(", ")}`);
    const i = changed[0] as number;
    assert.equal(v1[i], "Interpretação de cada turno:");
    assert.equal(
      v2[i],
      "Interpretação de cada turno: entregue-a chamando a ferramenta submitInterpretation exatamente uma vez, sozinha (sem outra ferramenta na mesma resposta) e por último, depois de receber os resultados das outras ferramentas.",
    );
    assert.equal(V1_PROMPT_VERSION, "spike-adr009-prompt-v1");
    assert.equal(PROMPT_VERSION, "spike-adr009-prompt-v2");
  });

  it("a linha nova e a descrição da submitInterpretation são as documentadas no CRITERIA da V2", () => {
    const v2Line = SYSTEM_PROMPT.split("\n").find((line) => line.startsWith("Interpretação de cada turno:")) ?? "";
    assert.ok(v2Criteria.includes(`\`${v2Line}\``));
    assert.ok(v2Criteria.includes(`\`${SUBMIT_DESCRIPTION}\``));
  });
});

describe("importação dos módulos da V1 sem efeito colateral", () => {
  it("importar os nove módulos da V1 num processo separado não imprime nem grava nada", () => {
    const resultsBefore = readdirSync(new URL("results/", SPIKE), { recursive: true }).length;
    const modules = ["run.ts", "score.ts", "run-record.ts", "tools.ts", "schema.ts", "models.ts", "cases-schema.ts", "fixtures.ts", "prompt.ts"];
    const script = modules.map((m) => `await import(${JSON.stringify(new URL(`src/${m}`, SPIKE).href)});`).join("\n");
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: fileURLToPath(SPIKE), encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, "", "nada no stdout");
    assert.equal(child.stderr, "", "nada no stderr");
    assert.equal(readdirSync(new URL("results/", SPIKE), { recursive: true }).length, resultsBefore, "nada gravado em results/");
  });
});

describe("manifesto da V2", () => {
  it("congelado: tabela presente no CRITERIA da V2, com os 28 arquivos, e todos os SHA-256 iguais (verifyManifest, o mesmo da CLI)", () => {
    const rows = verifyManifest();
    assert.equal(rows.length, 28);
    assert.deepEqual(rows.filter((r) => !r.ok).map((r) => r.file), []);
  });
});
