// Regra contra vazamento do gabarito, verificação automática (v4/CRITERIA.md, "Regra contra
// vazamento do gabarito", itens 1 a 4; "Ajustes da implementação (Etapa 2A)"): o prompt, cada
// descrição de tool e cada .describe, depois de normalizeText, não contêm os termos proibidos. O mesmo
// teste roda sobre o texto da V1 (controle: a regra não reprova a linha de base). O item 5, a paráfrase
// e os fragmentos abaixo do limite do item 3 ficam para a revisão humana.
//
// Operacionalização dos itens:
// - item 1: cada entrada e cada turno do funcionário nos históricos, inteiros, e também cada frase
//   deles (separada por . ! ?), quando a forma normalizada tiver 8 caracteres ou mais. Comparação como
//   substring do texto normalizado;
// - item 2: os termos aceitos em title e description do C4 (já normalizados no gabarito); substring;
// - item 3: ids e títulos dos artigos e dos chamados das fixtures, em qualquer tamanho (substring); dos
//   conteúdos dos artigos, os trechos de 3 ou mais palavras seguidas com forma normalizada total de 8
//   caracteres ou mais. Geração (item3Sequences): a partir de cada palavra do conteúdo, cadastra a
//   MENOR sequência que atende às duas condições (estende a janela palavra a palavra até atingir 3
//   palavras e 8 caracteres; se o conteúdo acabar antes, não cadastra). Cobertura completa: todo trecho
//   proibido começa em alguma palavra e contém, como prefixo, a sequência mínima cadastrada a partir
//   dela; detectar a sequência mínima basta. Deduplicação pela sequência de palavras normalizadas
//   (words.join(" ")), não pela string colada: sequências com a mesma concatenação e fronteiras
//   diferentes ficam as duas. Comparação palavra a palavra (não como substring do texto todo junto:
//   "do service desk" não casa com o trecho "O service desk" só porque "do" termina em "o").
//   LIMITE: fragmentos de 1 ou 2 palavras dos conteúdos não são detectados; ficam para a revisão
//   humana. Os termos isolados que identificam casos estão no item 4;
// - item 4: monitor, 809 e horario; substring.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ARTICLES, TICKETS, normalizeText } from "../../src/fixtures.ts";
import { SYSTEM_PROMPT as SYSTEM_PROMPT_V1 } from "../../src/prompt.ts";
import { TOOL_INPUT_SCHEMAS, createFakeTools } from "../../src/tools.ts";
import { loadCasesV4 } from "./cases.ts";
import { ARGUMENT_DESCRIPTIONS_V4, TOOL_DESCRIPTIONS_V4 } from "./descriptions.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";

interface Forbidden {
  item: 1 | 2 | 3 | 4;
  term: string;
  from: string;
  // Só nos trechos de conteúdo do item 3: sequência de 3 ou mais palavras normalizadas, comparadas palavra a palavra.
  words?: string[];
}

const MIN = 8;
const MIN_WORDS = 3;
const ITEM4 = ["monitor", "809", "horario"];
const cases = loadCasesV4().cases;

// Item 3, trechos de conteúdo: a menor sequência a partir de cada palavra com 3 ou mais palavras e
// forma normalizada total de 8 ou mais caracteres; deduplicada pela sequência de palavras normalizadas.
function item3Sequences(articles: readonly { id: string; content: string }[]): Forbidden[] {
  const out: Forbidden[] = [];
  const seen = new Set<string>();
  for (const a of articles) {
    const raw = a.content.split(/\s+/).filter((w) => normalizeText(w).length > 0);
    const words = raw.map(normalizeText);
    for (let start = 0; start < words.length; start++) {
      let end = start + MIN_WORDS;
      while (end <= words.length && words.slice(start, end).join("").length < MIN) end++;
      if (end > words.length) continue;
      const seq = words.slice(start, end);
      const key = seq.join(" ");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ item: 3, term: seq.join(""), from: `trecho de ${a.id}: "${raw.slice(start, end).join(" ")}"`, words: seq });
    }
  }
  return out;
}

function forbiddenTerms(): Forbidden[] {
  const out: Forbidden[] = [];
  const add = (item: Forbidden["item"], raw: string, from: string, minLength = 1) => {
    const term = normalizeText(raw);
    if (term.length >= minLength && !out.some((f) => f.term === term && f.item === item && f.words === undefined)) out.push({ item, term, from });
  };
  // Item 1: entradas e turnos do funcionário, inteiros e por frase.
  for (const c of cases) {
    const said = [c.input, ...c.history.filter((t) => t.role === "user").map((t) => t.content)];
    for (const text of said) {
      add(1, text, `${c.id}: "${text}"`, MIN);
      for (const sentence of text.split(/[.!?]+/)) add(1, sentence, `${c.id}: frase "${sentence.trim()}"`, MIN);
    }
  }
  // Item 2: termos aceitos em title e description do C4.
  const c4 = cases.find((c) => c.id === "C4");
  for (const rule of c4?.expected.toolArgs?.fields ?? []) {
    if ((rule.path === "title" || rule.path === "description") && rule.presence !== "absent" && rule.rule.match === "normalized-contains-any") {
      for (const v of rule.rule.values) add(2, v, `C4: termo de ${rule.path}`);
    }
  }
  // Item 3: fixtures.
  for (const a of ARTICLES) {
    add(3, a.id, `id ${a.id}`);
    add(3, a.title, `título de ${a.id}`);
  }
  out.push(...item3Sequences(ARTICLES));
  for (const t of TICKETS) {
    add(3, t.id, `id ${t.id}`);
    add(3, t.title, `título de ${t.id}`);
  }
  // Item 4: termos isolados.
  for (const term of ITEM4) add(4, term, "termo isolado");
  return out;
}

const FORBIDDEN = forbiddenTerms();
const findingsIn = (list: readonly Forbidden[], text: string): Forbidden[] => {
  const normalized = normalizeText(text);
  const words = text.split(/\s+/).map(normalizeText).filter((w) => w.length > 0);
  const hasSequence = (seq: string[]) => words.some((_, i) => seq.every((w, k) => words[i + k] === w));
  return list.filter((f) => (f.words ? hasSequence(f.words) : normalized.includes(f.term)));
};
const findings = (text: string): Forbidden[] => findingsIn(FORBIDDEN, text);
const item3Findings = (text: string): Forbidden[] => findings(text).filter((f) => f.item === 3);
const items = (text: string) => [...new Set(findings(text).map((f) => f.item))].sort();

const v1Tools = createFakeTools().tools;
const describeOf = (schema: unknown): string => String((schema as { description?: string }).description ?? "");

const TEXTS: Record<"V4" | "V1 (controle)", [string, string][]> = {
  V4: [
    ["prompt de sistema", SYSTEM_PROMPT],
    ["descrição da searchArticles", TOOL_DESCRIPTIONS_V4.searchArticles],
    ["descrição da listMyTickets", TOOL_DESCRIPTIONS_V4.listMyTickets],
    ["descrição da proposeTicketDraft", TOOL_DESCRIPTIONS_V4.proposeTicketDraft],
    ["descrição da requestHandoff", TOOL_DESCRIPTIONS_V4.requestHandoff],
    [".describe do query", ARGUMENT_DESCRIPTIONS_V4.searchArticles.query],
    [".describe do reason", ARGUMENT_DESCRIPTIONS_V4.requestHandoff.reason],
  ],
  "V1 (controle)": [
    ["prompt de sistema", SYSTEM_PROMPT_V1],
    ["descrição da searchArticles", String(v1Tools.searchArticles.description)],
    ["descrição da listMyTickets", String(v1Tools.listMyTickets.description)],
    ["descrição da proposeTicketDraft", String(v1Tools.proposeTicketDraft.description)],
    ["descrição da requestHandoff", String(v1Tools.requestHandoff.description)],
    [".describe do query", describeOf(TOOL_INPUT_SCHEMAS.searchArticles.shape.query)],
    [".describe do reason", describeOf(TOOL_INPUT_SCHEMAS.requestHandoff.shape.reason)],
  ],
};

describe("lista de termos proibidos", () => {
  it("cobre os quatro itens", () => {
    const byItem = [1, 2, 3, 4].map((item) => FORBIDDEN.filter((f) => f.item === item).length);
    console.log(`  termos proibidos por item: 1 = ${byItem[0]}, 2 = ${byItem[1]}, 3 = ${byItem[2]}, 4 = ${byItem[3]}`);
    assert.ok(byItem.every((n) => (n ?? 0) > 0));
  });

  it("item 1 inclui a entrada inteira e cada frase", () => {
    const terms = FORBIDDEN.filter((f) => f.item === 1).map((f) => f.term);
    assert.ok(terms.includes(normalizeText("Minha VPN está dando erro 809. Uso Windows 10.")), "entrada inteira");
    assert.ok(terms.includes(normalizeText("Uso Windows 10")), "frase");
  });
});

describe("controles positivos", () => {
  it("cada item detecta o seu termo", () => {
    assert.deepEqual(items("Parou tudo!"), [1]);
    assert.ok(items("Peça um segundo monitor").includes(2));
    assert.ok(items("Ver o TKT-A1").includes(3));
    assert.ok(items("Se persistir, abra um chamado.").includes(3), "trecho literal de 3 palavras do conteúdo");
    assert.ok(items("Horários").includes(4));
  });

  it("sequência de mais de 3 palavras do conteúdo é detectada", () => {
    assert.ok(items("Incidentes críticos têm plantão o tempo todo.").includes(3));
  });
});

describe("casos de fronteira", () => {
  it("fragmento proibido com pontuação diferente: detectado", () => {
    assert.ok(items("parou... tudo").includes(1));
    assert.ok(items("Se persistir abra um chamado").includes(3), "trecho do item 3 sem a vírgula");
  });

  it("fragmento proibido com ou sem acentos: detectado", () => {
    assert.ok(items("so para mim").includes(1), "sem o acento de 'Só'");
    assert.ok(items("SÓ PARA MIM").includes(1), "maiúsculas e acento");
  });

  it("frase do funcionário abaixo de 8 caracteres normalizados: não detectada", () => {
    assert.equal(normalizeText("Não.").length < MIN, true);
    assert.deepEqual(findings("Não."), []);
  });

  it("palavras parecidas com fronteira diferente: não detectadas ('do service desk' não é o trecho 'O service desk')", () => {
    assert.ok(FORBIDDEN.some((f) => f.words?.join(" ") === "o service desk"), "o trecho 'O service desk' está cadastrado");
    assert.deepEqual(findings("o assistente do service desk"), []);
  });

  it("fragmento de 2 palavras do conteúdo, sem termo do item 4: não detectado (limite registrado do item 3)", () => {
    const fragment = "incidentes críticos";
    assert.ok(normalizeText(ARTICLES.map((a) => a.content).join(" ")).includes(normalizeText(fragment)), "o fragmento vem do conteúdo de um artigo");
    assert.equal(ITEM4.some((t) => normalizeText(fragment).includes(t)), false, "sem termo do item 4");
    assert.deepEqual(item3Findings(`Os ${fragment} são tratados primeiro.`), []);
    assert.deepEqual(findings(`Os ${fragment} são tratados primeiro.`), []);
  });

  it("palavras soltas comuns não são banidas pelo item 3", () => {
    assert.deepEqual(findings("atendimento e funcionamento"), []);
  });
});

describe("item 3, geração das sequências (conteúdos fabricados no teste; fixtures inalteradas)", () => {
  it("sequência de 4 palavras com 8 caracteres e janelas de 3 abaixo de 8: cadastrada e detectada", () => {
    const list = item3Sequences([{ id: "FAB-1", content: "ab cd ef gh" }]);
    assert.equal(normalizeText("ab cd ef").length < MIN && normalizeText("cd ef gh").length < MIN, true, "janelas de 3 abaixo de 8");
    assert.deepEqual(list.map((f) => f.words?.join(" ")), ["ab cd ef gh"], "a menor sequência a partir de 'ab' tem 4 palavras; a partir de 'cd' o conteúdo acaba antes");
    assert.equal(findingsIn(list, "texto com ab, cd, ef e gh").length, 0, "palavras não seguidas: não detectada");
    assert.equal(findingsIn(list, "Ab cd ef gh no meio do texto").length, 1);
  });

  it("duas sequências com a mesma concatenação e fronteiras diferentes: as duas cadastradas e detectadas", () => {
    const list = item3Sequences([
      { id: "FAB-2", content: "abc def ghi" },
      { id: "FAB-3", content: "ab cdef ghi" },
    ]);
    assert.deepEqual(list.map((f) => f.words?.join(" ")).sort(), ["ab cdef ghi", "abc def ghi"]);
    assert.equal(new Set(list.map((f) => f.term)).size, 1, "mesma concatenação");
    assert.deepEqual(findingsIn(list, "abc def ghi").map((f) => f.from), ['trecho de FAB-2: "abc def ghi"']);
    assert.deepEqual(findingsIn(list, "ab cdef ghi").map((f) => f.from), ['trecho de FAB-3: "ab cdef ghi"']);
  });

  it("fragmento de 2 palavras: não cadastrado nem detectado pelo item 3", () => {
    const list = item3Sequences([{ id: "FAB-4", content: "alfabetizado numericamente" }]);
    assert.deepEqual(list, [], "o conteúdo acaba antes de 3 palavras");
    const longer = item3Sequences([{ id: "FAB-5", content: "alfabetizado numericamente agora" }]);
    assert.deepEqual(findingsIn(longer, "alfabetizado numericamente"), []);
  });

  it("'do service desk' continua não detectado", () => {
    const list = item3Sequences([{ id: "FAB-6", content: "O service desk atende." }]);
    assert.deepEqual(findingsIn(list, "o assistente do service desk"), []);
    assert.equal(findingsIn(list, "o assistente: o service desk").length, 1, "controle: com a fronteira certa, detectado");
  });
});

for (const [version, texts] of Object.entries(TEXTS)) {
  describe(`vazamento, ${version}`, () => {
    for (const [name, text] of texts) {
      it(`${name}: nenhum termo proibido (${normalizeText(text).length} caracteres normalizados)`, () => {
        assert.ok(text.length > 0, "texto vazio");
        assert.deepEqual(findings(text).map((f) => `item ${f.item}: ${f.term} (${f.from})`), []);
      });
    }
  });
}
