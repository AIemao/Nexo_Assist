// Gerador da referência da V4 (ADR-009, nota de 2026-11-22, W8.1; plano do web, F3).
//
// Uso, a partir de apps/web:
//   node scripts/baseline-v4/generate.ts <cópia da tag>/spikes/llm-model
// onde a cópia vem de `git archive spike-adr-009 spikes/llm-model`, extraída fora do repositório,
// com `npm ci` rodado nela (lockfile da tag).
//
// W8.2: o código do spike só roda aqui, importado pelo caminho da cópia. Nenhum módulo de
// apps/web/src importa este gerador nem a cópia. Sem rede: as respostas do modelo são roteirizadas
// com o withHttp da tag (v3/src/test-helpers.ts).
//
// Escreve em apps/web/test/baseline/v4/: projection.json, results-descriptor.json,
// history-cases.json e manifest.json; e copia, byte a byte, os textos da V4 para
// apps/web/src/server/agent/baseline/v4/ (prompt.ts e descriptions.ts).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type Loose = Record<string, unknown>;
type ToolCallSpec = [id: string, name: string, args: unknown];

interface SeenRequest {
  url: string;
  method: string;
  body: Loose;
}

interface TagModules {
  runAttempt(input: Loose, attempt: number): Promise<{ record: unknown; error: unknown }>;
  withHttp<T>(script: unknown[], fn: () => Promise<T>): Promise<{ result: T; requests: SeenRequest[] }>;
  completion(calls: ToolCallSpec[]): unknown;
  textCompletion(text: string): unknown;
  turnInput(caseId: string, extra: Loose): Loose;
  toMessages(testCase: Loose): unknown[];
  filterTranscript(messages: readonly unknown[]): unknown[];
  providerOptions: unknown;
  promptVersion: string;
}

const TAG = "spike-adr-009";
const SPIKE_PATH = "spikes/llm-model";
const MODEL = { id: "ollama/qwen3:8b", url: "http://localhost:11434/v1" };
const MODEL_LABEL = "ollama qwen3:8b";
const ALLOWED_HOSTS = ["localhost:11434"];
const PLACEHOLDER = "<EXCLUIDO>";
// Interpretação válida no schema da fase 2 (interpretationSchema da V1, usado pela V4).
const VALID_INTERPRETATION = JSON.stringify({ intent: "ANSWER_KB", confidence: "HIGH", entities: {}, missingFields: [] });

// Referência do ambiente das evidências, como registrada no ADR-009 ("Evidências do spike").
const EVIDENCE_ENVIRONMENT = {
  ollama: "0.40.16",
  ollamaContextLength: 8192,
  model: "qwen3:8b",
  modelDigest: "500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41",
  source: "docs/decisions/ADR-009-modelo-llm.md, \"Evidências do spike\"",
};

const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const repoRoot = resolve(webRoot, "..", "..");
const outDir = join(webRoot, "test", "baseline", "v4");
const textsDir = join(webRoot, "src", "server", "agent", "baseline", "v4");

const COPIED_TEXTS = [
  { source: "v4/src/prompt.ts", target: join(textsDir, "prompt.ts") },
  { source: "v4/src/descriptions.ts", target: join(textsDir, "descriptions.ts") },
];

function fail(message: string): never {
  throw new Error(message);
}

function isLoose(value: unknown): value is Loose {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// JSON canônico: chaves de objeto ordenadas; ordem dos arrays preservada (W8.1).
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isLoose(value)) {
    const sorted: Loose = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonical(value[key]);
    return sorted;
  }
  return value;
}

function canonicalText(value: unknown): string {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function git(args: string[]): Buffer {
  return execFileSync("git", args, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
}

// ---------------------------------------------------------------------------
// Cópia da tag: fora do repositório e idêntica aos blobs da tag.

function checkTagCopy(tagRoot: string, commit: string): number {
  const rel = relative(repoRoot, tagRoot);
  if (!rel.startsWith("..") && !/^[A-Za-z]:/.test(rel)) fail(`a cópia da tag precisa ficar fora do repositório: ${tagRoot}`);
  if (tagRoot.split(sep).includes("node_modules")) fail(`a cópia da tag não pode ficar dentro de node_modules: ${tagRoot}`);
  if (!existsSync(join(tagRoot, "node_modules", "@mastra", "core", "package.json"))) {
    fail(`a cópia da tag não tem node_modules: rode npm ci em ${tagRoot}`);
  }
  const files = git(["ls-tree", "-r", "--name-only", commit, "--", SPIKE_PATH])
    .toString("utf8")
    .split("\n")
    .filter((file) => file !== "" && !/\/results\//.test(file));
  for (const file of files) {
    const local = join(tagRoot, file.slice(SPIKE_PATH.length + 1));
    if (!existsSync(local)) fail(`arquivo da tag ausente na cópia: ${file}`);
    if (!readFileSync(local).equals(git(["cat-file", "blob", `${commit}:${file}`]))) {
      fail(`arquivo da cópia diferente do blob da tag: ${file}`);
    }
  }
  return files.length;
}

function packageVersion(tagRoot: string, name: string): string {
  const pkg: unknown = JSON.parse(readFileSync(join(tagRoot, "node_modules", ...name.split("/"), "package.json"), "utf8"));
  const version = isLoose(pkg) ? pkg["version"] : undefined;
  return typeof version === "string" ? version : fail(`versão de ${name} não encontrada na cópia`);
}

async function loadTagModules(tagRoot: string): Promise<TagModules> {
  // O src/models.ts da tag lê OLLAMA_BASE_URL na importação: a referência usa o endpoint padrão.
  delete process.env["OLLAMA_BASE_URL"];
  const load = (file: string) => import(pathToFileURL(join(tagRoot, file)).href);
  const run = await load("v4/src/run.ts");
  const helpers = await load("v3/src/test-helpers.ts");
  const v1run = await load("src/run.ts");
  const transcript = await load("v3/src/transcript.ts");
  const prompt = await load("v4/src/prompt.ts");
  return {
    runAttempt: run.runAttempt,
    withHttp: helpers.withHttp,
    completion: helpers.completion,
    textCompletion: helpers.textCompletion,
    turnInput: helpers.turnInput,
    toMessages: v1run.toMessages,
    filterTranscript: transcript.filterTranscript,
    // Como na execução real das evidências (cliRunOptions com REASONING_CONTROL do provider).
    providerOptions: v1run.REASONING_CONTROL.ollama.providerOptions,
    promptVersion: prompt.PROMPT_VERSION,
  };
}

async function capture(tag: TagModules, calls: ToolCallSpec[]): Promise<SeenRequest[]> {
  const input = tag.turnInput("C1", {
    model: MODEL,
    modelLabel: MODEL_LABEL,
    allowedHosts: ALLOWED_HOSTS,
    providerOptions: tag.providerOptions,
  });
  const script = [tag.completion(calls), tag.textCompletion("x"), tag.textCompletion(VALID_INTERPRETATION)];
  const { result, requests } = await tag.withHttp(script, () => tag.runAttempt(input, 1));
  if (result.error !== null) fail(`runAttempt terminou com erro: ${JSON.stringify(result.error)}`);
  if (requests.length !== 3) fail(`esperadas 3 requisições (fase 1, fase 1 depois da tool, fase 2), recebidas ${requests.length}`);
  return requests;
}

// ---------------------------------------------------------------------------
// a) Projeção da requisição (PW-2).

const EXCLUSIONS = [
  { path: '$.messages[1:][?role=="user"].content', reason: "texto do turno" },
  { path: '$.messages[1:][?role=="assistant"].content', reason: "texto do turno, gerado pelo modelo" },
  { path: "$.messages[*].tool_calls[*].id", reason: "id gerado a cada execução" },
  { path: "$.messages[*].tool_call_id", reason: "id gerado a cada execução" },
  {
    path: "$.messages[*].tool_calls[*].function.arguments",
    reason: "conteúdo do turno; a estrutura é coberta pelo schema da tool",
  },
  {
    path: '$.messages[?role=="tool"].content',
    reason: "resultado da tool; a estrutura é coberta por results-descriptor.json",
  },
];

function project(body: Loose): { body: Loose; excluded: string[] } {
  const copy: unknown = structuredClone(body);
  if (!isLoose(copy)) fail("corpo da requisição não é um objeto");
  const excluded: string[] = [];
  const messages = copy["messages"];
  if (!Array.isArray(messages)) fail("corpo sem messages");
  messages.forEach((message: unknown, index) => {
    if (!isLoose(message)) fail(`mensagem ${index} não é um objeto`);
    const role = message["role"];
    const exclude = (key: string) => {
      if (key in message) {
        message[key] = PLACEHOLDER;
        excluded.push(`$.messages[${index}].${key}`);
      }
    };
    if (index >= 1 && (role === "user" || role === "assistant" || role === "tool")) exclude("content");
    exclude("tool_call_id");
    const toolCalls = message["tool_calls"];
    if (Array.isArray(toolCalls)) {
      toolCalls.forEach((call: unknown, callIndex) => {
        if (!isLoose(call)) fail(`tool_calls[${callIndex}] não é um objeto`);
        if ("id" in call) {
          call["id"] = PLACEHOLDER;
          excluded.push(`$.messages[${index}].tool_calls[${callIndex}].id`);
        }
        const fn = call["function"];
        if (isLoose(fn) && "arguments" in fn) {
          fn["arguments"] = PLACEHOLDER;
          excluded.push(`$.messages[${index}].tool_calls[${callIndex}].function.arguments`);
        }
      });
    }
  });
  return { body: copy, excluded };
}

const REQUEST_LABELS = ["fase1-antes-da-tool", "fase1-depois-da-tool", "fase2"];

function projectRequests(requests: SeenRequest[]) {
  return requests.map((request, index) => {
    const { body, excluded } = project(request.body);
    return {
      label: REQUEST_LABELS[index],
      method: request.method,
      path: new URL(request.url).pathname,
      excludedPaths: excluded,
      body,
    };
  });
}

async function buildProjection(tag: TagModules) {
  const calls: ToolCallSpec[] = [["S1", "searchArticles", { query: "x" }]];
  const first = projectRequests(await capture(tag, calls));
  // Parada 3 do plano: um campo dinâmico fora da lista de exclusão faz duas execuções divergirem.
  const second = projectRequests(await capture(tag, calls));
  if (!isDeepStrictEqual(first, second)) {
    fail("duas execuções produziram projeções diferentes: há campo dinâmico fora da lista de exclusão");
  }
  return {
    description:
      "Projeção da requisição da V4 ao Ollama (ADR-009, nota de 2026-11-22, W8.1; PW-2): caso C1, qwen3:8b, uma chamada de searchArticles. Corpo inteiro menos os caminhos excluídos (valor trocado pelo marcador). Ordem dos arrays preservada; chaves em ordem canônica.",
    model: MODEL.id,
    placeholder: PLACEHOLDER,
    exclusions: EXCLUSIONS,
    requests: first,
  };
}

// ---------------------------------------------------------------------------
// b) Estrutura dos resultados que chegaram ao modelo (W8.1; plano T6).

type Presence = "required" | "optional";
interface FieldEntry {
  path: string;
  types: string[];
  presence: Presence;
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

// Estrutura de um valor: para cada caminho, os tipos vistos e se a chave está em todos os objetos
// que têm o pai (required) ou falta em algum (optional). Itens de array: "[]". Nunca os valores.
function describe(value: unknown): FieldEntry[] {
  const seen = new Map<string, { types: Set<string>; present: number; parents: number }>();
  const note = (path: string, types: string[], present: boolean) => {
    const entry = seen.get(path) ?? { types: new Set<string>(), present: 0, parents: 0 };
    for (const type of types) entry.types.add(type);
    entry.parents += 1;
    if (present) entry.present += 1;
    seen.set(path, entry);
  };
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      for (const item of node) {
        note(`${path}[]`, [typeOf(item)], true);
        walk(item, `${path}[]`);
      }
    } else if (isLoose(node)) {
      for (const [key, child] of Object.entries(node)) {
        note(`${path}.${key}`, [typeOf(child)], true);
        walk(child, `${path}.${key}`);
      }
    }
  };
  // Chaves ausentes em parte dos objetos de um mesmo array: optional.
  const keysByParent = new Map<string, { keys: Set<string>; objects: Loose[] }>();
  const collect = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      for (const item of node) collect(item, `${path}[]`);
    } else if (isLoose(node)) {
      const group = keysByParent.get(path) ?? { keys: new Set<string>(), objects: [] };
      for (const key of Object.keys(node)) group.keys.add(key);
      group.objects.push(node);
      keysByParent.set(path, group);
      for (const [key, child] of Object.entries(node)) collect(child, `${path}.${key}`);
    }
  };
  note("$", [typeOf(value)], true);
  walk(value, "$");
  collect(value, "$");
  for (const [parent, group] of keysByParent) {
    for (const key of group.keys) {
      const missing = group.objects.filter((object) => !(key in object)).length;
      const entry = seen.get(`${parent}.${key}`);
      if (entry !== undefined) entry.parents += missing;
    }
  }
  return [...seen.entries()]
    .map(([path, entry]) => ({
      path,
      types: [...entry.types].sort(),
      presence: entry.present === entry.parents ? ("required" as const) : ("optional" as const),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

interface Variant {
  tool: string;
  variant: string;
  call: ToolCallSpec;
  produces: string;
}

const PROPOSE_ARGS = {
  title: "t",
  description: "d",
  type: "REQ",
  category: "HARDWARE",
  impactAssessment: { affectedScope: "SELF", workImpact: "NONE", commitmentRisk: "NO" },
};

const VARIANTS: Variant[] = [
  {
    tool: "searchArticles",
    variant: "lista-vazia",
    call: ["R1", "searchArticles", { query: "x" }],
    produces: "consulta sem palavra-chave de nenhum artigo",
  },
  {
    tool: "searchArticles",
    variant: "artigo-sem-applicability",
    call: ["R2", "searchArticles", { query: "horario" }],
    produces: "consulta com palavra-chave do artigo de horário (sem applicability na fixture)",
  },
  {
    tool: "searchArticles",
    variant: "artigo-com-applicability",
    call: ["R3", "searchArticles", { query: "vpn 809" }],
    produces: "consulta com palavra-chave do artigo de VPN (com applicability na fixture)",
  },
  {
    tool: "listMyTickets",
    variant: "fixtures",
    call: ["R4", "listMyTickets", {}],
    produces: "chamados da sessão nas fixtures da tag",
  },
  {
    tool: "proposeTicketDraft",
    variant: "constante",
    call: ["R5", "proposeTicketDraft", PROPOSE_ARGS],
    produces: "rascunho válido; o execute devolve resultado constante",
  },
  {
    tool: "requestHandoff",
    variant: "constante",
    call: ["R6", "requestHandoff", {}],
    produces: "pedido sem motivo; o execute devolve resultado constante",
  },
  {
    tool: "searchArticles",
    variant: "recusa-de-validacao-do-mastra",
    call: ["R7", "searchArticles", { query: "" }],
    produces: "argumento inválido (query vazia, min(1)): o Mastra recusa antes do execute",
  },
  {
    tool: "inventada",
    variant: "tool-inexistente",
    call: ["R8", "inventada", {}],
    produces: "nome de tool que não existe no Agent",
  },
];

// O resultado como chegou ao modelo: a mensagem tool da requisição seguinte à tool call.
function toolResultInBody(requests: SeenRequest[], callId: string): { encoding: "json" | "text"; value: unknown } {
  const messages = requests[1]?.body["messages"];
  if (!Array.isArray(messages)) fail("segunda requisição sem messages");
  const message = messages.find((m: unknown) => isLoose(m) && m["role"] === "tool" && m["tool_call_id"] === callId);
  if (!isLoose(message)) fail(`mensagem tool de ${callId} não encontrada no corpo da segunda requisição`);
  const content = message["content"];
  if (typeof content !== "string") fail(`conteúdo da mensagem tool de ${callId} não é texto`);
  try {
    return { encoding: "json", value: JSON.parse(content) };
  } catch {
    return { encoding: "text", value: content };
  }
}

// Variantes que são o resultado do execute da tool; as demais vêm do Mastra (recusa e inexistente).
const ERROR_VARIANTS = new Set(["recusa-de-validacao-do-mastra", "tool-inexistente"]);

async function buildResultsDescriptor(tag: TagModules) {
  const variants = [];
  const valuesByTool = new Map<string, unknown[]>();
  for (const variant of VARIANTS) {
    const result = toolResultInBody(await capture(tag, [variant.call]), variant.call[0]);
    variants.push({
      tool: variant.tool,
      variant: variant.variant,
      producedBy: variant.produces,
      encoding: result.encoding,
      fields: describe(result.value),
    });
    if (!ERROR_VARIANTS.has(variant.variant)) {
      valuesByTool.set(variant.tool, [...(valuesByTool.get(variant.tool) ?? []), result.value]);
    }
  }
  // Agregado por tool, sobre as variantes do execute: um campo ausente em alguma variante é optional.
  const byTool = Object.fromEntries(
    [...valuesByTool.entries()].map(([tool, values]) => [
      tool,
      describe(values)
        .filter((field) => field.path !== "$")
        .map((field) => ({ ...field, path: field.path.replace(/^\$\[\]/, "$") })),
    ]),
  );
  return {
    description:
      "Estrutura dos resultados das tools que chegaram ao modelo na V4 (ADR-009, nota de 2026-11-22, W8.1; plano T6). Extraída do conteúdo da mensagem tool na requisição seguinte à tool call, em execuções do runAttempt da V4 com respostas roteirizadas. Só estrutura: caminho, tipos (\"null\" é tipo) e presença (required = em todos os objetos que têm o pai; optional = ausente em algum). Nunca os valores das fixtures.",
    notes: [
      "A lista vazia da listMyTickets não é produzida pela tag (as fixtures sempre têm chamados da sessão): é variante do produto, não da linha de base.",
      "encoding text: o conteúdo da mensagem tool não é JSON (texto do Mastra para tool inexistente).",
      "byTool: agregado das variantes do execute de cada tool (sem as variantes de recusa e de tool inexistente, produzidas pelo Mastra). Nenhum campo null aparece nas variantes da V4.",
    ],
    byTool,
    variants,
  };
}

// ---------------------------------------------------------------------------
// c) Histórico (toMessages) e filtro da fase 2 (filterTranscript) da tag.

const tc = (id: string, name: string, input: unknown) => ({ type: "tool-call", toolCallId: id, toolName: name, input });
const tr = (id: string, name: string, value: unknown) => ({
  type: "tool-result",
  toolCallId: id,
  toolName: name,
  output: { type: "json", value },
});

const HISTORY_INPUTS: { id: string; description: string; testCase: Loose }[] = [
  { id: "H1", description: "histórico vazio mais input", testCase: { history: [], input: "Olá." } },
  {
    id: "H2",
    description: "par user/assistant sem tool",
    testCase: {
      history: [
        { role: "user", content: "Pergunta anterior." },
        { role: "assistant", content: "Resposta anterior." },
      ],
      input: "Nova pergunta.",
    },
  },
  {
    id: "H3",
    description: "assistant com content e uma tool call com resultado",
    testCase: {
      history: [
        { role: "user", content: "Pergunta anterior." },
        {
          role: "assistant",
          content: "Texto final do turno anterior.",
          toolCalls: [{ tool: "searchArticles", args: { query: "consulta" }, result: { articles: [] } }],
        },
      ],
      input: "Nova pergunta.",
    },
  },
  {
    id: "H4",
    description: "assistant com content e duas tool calls no mesmo turno",
    testCase: {
      history: [
        { role: "user", content: "Pergunta anterior." },
        {
          role: "assistant",
          content: "Texto final do turno anterior.",
          toolCalls: [
            { tool: "searchArticles", args: { query: "consulta" }, result: { articles: [] } },
            { tool: "listMyTickets", args: {}, result: { tickets: [] } },
          ],
        },
      ],
      input: "Nova pergunta.",
    },
  },
];

const FILTER_INPUTS: { id: string; description: string; messages: unknown[] }[] = [
  {
    id: "F1",
    description: "fase 1 sem tool",
    messages: [{ role: "assistant", content: [{ type: "text", text: "Texto final." }] }],
  },
  {
    id: "F2",
    description: "uma tool e texto final",
    messages: [
      { role: "assistant", content: [tc("A1", "searchArticles", { query: "consulta" })] },
      { role: "tool", content: [tr("A1", "searchArticles", { articles: [] })] },
      { role: "assistant", content: [{ type: "text", text: "Texto final." }] },
    ],
  },
  {
    id: "F3",
    description: "partes de raciocínio",
    messages: [
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "raciocínio" }, tc("A1", "searchArticles", { query: "consulta" })],
      },
      { role: "tool", content: [tr("A1", "searchArticles", { articles: [] })] },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "raciocínio" },
          { type: "text", text: "Texto final." },
        ],
      },
    ],
  },
  {
    id: "F4",
    description: "assistant só com raciocínio",
    messages: [
      { role: "assistant", content: [{ type: "reasoning", text: "raciocínio" }] },
      { role: "assistant", content: [tc("A1", "searchArticles", { query: "consulta" })] },
      { role: "tool", content: [tr("A1", "searchArticles", { articles: [] })] },
      { role: "assistant", content: [{ type: "text", text: "Texto final." }] },
    ],
  },
  {
    id: "F5",
    description: "texto intermediário junto da tool call",
    messages: [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Texto intermediário." },
          tc("A1", "searchArticles", { query: "consulta" }),
        ],
      },
      { role: "tool", content: [tr("A1", "searchArticles", { articles: [] })] },
      { role: "assistant", content: [{ type: "text", text: "Texto final." }] },
    ],
  },
];

// Parada 4 do plano (DM v2.19 §3.12): o texto do assistant fica numa mensagem própria, depois dos
// resultados, e nunca dentro da mensagem com as tool calls.
function checkAssistantTextAfterResults(id: string, output: unknown[], content: string): void {
  const index = output.findIndex(
    (m) => isLoose(m) && m["role"] === "assistant" && Array.isArray(m["content"]) && m["content"].some((p) => isLoose(p) && p["type"] === "tool-call"),
  );
  const withCalls = output[index];
  if (!isLoose(withCalls) || !Array.isArray(withCalls["content"])) fail(`${id}: mensagem assistant com tool calls não encontrada`);
  if (withCalls["content"].some((p: unknown) => isLoose(p) && p["type"] !== "tool-call")) {
    fail(`${id}: a mensagem assistant com tool calls tem outras partes além das tool calls`);
  }
  const toolMessage = output[index + 1];
  const textMessage = output[index + 2];
  if (!isLoose(toolMessage) || toolMessage["role"] !== "tool") fail(`${id}: a mensagem tool não vem logo depois das tool calls`);
  if (!isLoose(textMessage) || textMessage["role"] !== "assistant" || textMessage["content"] !== content) {
    fail(`${id}: o texto do assistant não está numa mensagem própria depois dos resultados`);
  }
}

function buildHistoryCases(tag: TagModules) {
  const toMessagesCases = HISTORY_INPUTS.map(({ id, description, testCase }) => {
    const output = tag.toMessages(testCase);
    if (id === "H3" || id === "H4") checkAssistantTextAfterResults(id, output, "Texto final do turno anterior.");
    return { id, function: "toMessages", description, input: testCase, output };
  });
  const filterCases = FILTER_INPUTS.map(({ id, description, messages }) => ({
    id,
    function: "filterTranscript",
    description,
    input: messages,
    output: tag.filterTranscript(messages),
  }));
  return {
    description:
      "Entradas e saídas de referência do toMessages (src/run.ts) e do filterTranscript (v3/src/transcript.ts) da tag (ADR-009, nota de 2026-11-22, W8.1). Ids gerados pela tag ficam como ela gerou.",
    cases: [...toMessagesCases, ...filterCases],
  };
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argument = process.argv[2];
  if (argument === undefined) fail("uso: node scripts/baseline-v4/generate.ts <cópia da tag>/spikes/llm-model");
  const tagRoot = resolve(argument);
  const commit = git(["rev-parse", `${TAG}^{commit}`]).toString("utf8").trim();
  const checked = checkTagCopy(tagRoot, commit);
  console.log(`[baseline] cópia da tag conferida contra ${checked} blobs de ${TAG} (${commit})`);

  const tag = await loadTagModules(tagRoot);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(textsDir, { recursive: true });

  const artifacts = {
    "projection.json": canonicalText(await buildProjection(tag)),
    "results-descriptor.json": canonicalText(await buildResultsDescriptor(tag)),
    "history-cases.json": canonicalText(buildHistoryCases(tag)),
  };
  for (const [name, text] of Object.entries(artifacts)) writeFileSync(join(outDir, name), text);

  const texts: Loose = {};
  for (const { source, target } of COPIED_TEXTS) {
    const bytes = git(["cat-file", "blob", `${commit}:${SPIKE_PATH}/${source}`]);
    writeFileSync(target, bytes);
    texts[relative(webRoot, target).split(sep).join("/")] = { source: `${SPIKE_PATH}/${source}`, sha256: sha256(bytes) };
  }

  const manifest = {
    description: "Manifesto da referência da V4 (ADR-009, nota de 2026-11-22, W8.1). Sem hash de si mesmo.",
    tag: { name: TAG, commit },
    promptVersion: tag.promptVersion,
    packages: {
      "@mastra/core": packageVersion(tagRoot, "@mastra/core"),
      "@mastra/schema-compat": packageVersion(tagRoot, "@mastra/schema-compat"),
      zod: packageVersion(tagRoot, "zod"),
    },
    provider: {
      path: "model router do @mastra/core com url; provider compatível com OpenAI empacotado no @mastra/core",
      request: "POST /v1/chat/completions",
      model: MODEL.id,
    },
    evidenceEnvironment: EVIDENCE_ENVIRONMENT,
    artifacts: Object.fromEntries(
      Object.entries(artifacts).map(([name, text]) => [`test/baseline/v4/${name}`, { sha256: sha256(text) }]),
    ),
    copiedTexts: texts,
    generator: "scripts/baseline-v4/generate.ts",
    generatedOn: new Date().toISOString().slice(0, 10),
  };
  writeFileSync(join(outDir, "manifest.json"), canonicalText(manifest));
  console.log(`[baseline] artefatos escritos em ${relative(repoRoot, outDir)} e textos em ${relative(repoRoot, textsDir)}`);
}

main().catch((error: unknown) => {
  console.error("[baseline] FALHOU:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
