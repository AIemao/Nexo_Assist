// Sondagens Q1 e Q2 (fora do manifesto): roteiro completo com HTTP fabricado, sem modelo real.
// Confere as métricas e que nenhum texto do modelo, argumento ou resultado de tool vai para disco.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";

import { FORBIDDEN, outputMetrics, runProbes, writeProbeFiles } from "./probe.ts";
import { OLLAMA, OLLAMA_HOST, VALID, cases, completion, reply, textCompletion, withHttp } from "../src/test-helpers.ts";

const valid = JSON.stringify(VALID.C3);
const MARK = "TEXTO-DO-MODELO";

describe("métricas da saída (sem gravar o texto)", () => {
  it("JSON puro, cerca, prosa, vazio e length", () => {
    assert.equal(outputMetrics(valid, "stop").pureJson, true);
    assert.equal(outputMetrics(valid, "stop").zodValid, true);
    assert.equal(outputMetrics("```json\n{}\n```", "stop").fenced, true);
    assert.equal(outputMetrics(`Segue ${valid}`, "stop").proseAroundJson, true);
    assert.equal(outputMetrics("", "stop").empty, true);
    assert.equal(outputMetrics(valid, "length").parse, "LENGTH");
  });
});

describe("roteiro das sondagens com HTTP fabricado", () => {
  it("Q1 (3), Q2a (2, uma recusada com 400) e Q2b (2): metadados apenas, nada do texto em disco", async () => {
    const script = [
      textCompletion(valid),
      textCompletion("```json\n" + valid + "\n```"),
      textCompletion(`${MARK} ${valid}`),
      textCompletion(valid),
      reply(400, { error: { message: "messages with role tool require tools" } }),
      completion([["L1", "listMyTickets", {}]]),
      textCompletion(MARK),
      textCompletion(valid),
      textCompletion(MARK),
      textCompletion(valid),
    ];
    const { result: entries, requests } = await withHttp(script, () => runProbes({ model: OLLAMA.config, modelLabel: OLLAMA.label, allowedHosts: [OLLAMA_HOST], templateCase: cases[0]! }));
    assert.equal(requests.length, 10);
    const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
    assert.equal((byId["Q1-1"]?.["output"] as { pureJson: boolean }).pureJson, true);
    assert.equal((byId["Q1-2"]?.["output"] as { fenced: boolean }).fenced, true);
    assert.equal(byId["Q2a-1"]?.["accepted"], true);
    assert.equal((byId["Q2a-1"]?.["requestShape"] as { toolMessages: number; tools: boolean }).toolMessages, 1);
    assert.equal((byId["Q2a-1"]?.["requestShape"] as { tools: boolean }).tools, false, "a fase 2 não declara tools");
    assert.equal(byId["Q2a-2"]?.["accepted"], false);
    assert.equal(byId["Q2b-1"]?.["exercisedQ2"], true);
    assert.deepEqual(byId["Q2b-1"]?.["invariants"], []);
    assert.equal(byId["Q2b-2"]?.["exercisedQ2"], false, "fase 1 sem tool: Q2 não exercitada");
    const dir = mkdtempSync(join(tmpdir(), "spike-v3-probe-"));
    try {
      const files = writeProbeFiles({ type: "probe-run", model: OLLAMA.label, startedAt: "t" }, entries, pathToFileURL(`${dir}/`));
      const written = readFileSync(files.jsonl, "utf8") + readFileSync(files.markdown, "utf8");
      assert.equal(written.includes(MARK), false, "nenhum texto do modelo");
      assert.equal(written.includes("TKT-"), false, "nenhum resultado de tool");
      assert.equal(written.includes("configurar vpn celular"), false, "nenhum argumento de tool");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("conteúdo proibido: nada é gravado", () => {
    assert.ok(FORBIDDEN.test("Bearer x"));
    assert.throws(() => writeProbeFiles({ type: "probe-run", model: "m", startedAt: "t", nota: "authorization" }, []), /conteúdo proibido/);
  });
});
