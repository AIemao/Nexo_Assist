// Fase 2 (v3/CRITERIA.md, "Interpretação oficial", "Classificação das falhas da fase 2") e camada
// de captura da V3 (seção "Reutilização", monitor em duas camadas; "Falha do instrumento").

import { sanitize } from "../../src/run.ts";
import type { InstrumentFailure, Phase2Parse, Phase2Request } from "./record.ts";

type Loose = Record<string, unknown>;
const asLoose = (value: unknown): Loose => (typeof value === "object" && value !== null ? (value as Loose) : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

// Interpretação oficial: JSON.parse(text), sem remover cercas, sem extrair de prosa, sem reparar.
// finishReason "length": null, mesmo com JSON aparentemente completo.
export function readInterpretation(text: string, finishReason: string | null): { value: unknown; parse: Phase2Parse } {
  if (finishReason === "length") return { value: null, parse: "LENGTH" };
  if (text.trim() === "") return { value: null, parse: "EMPTY" };
  try {
    return { value: JSON.parse(text) as unknown, parse: "OK" };
  } catch {
    return { value: null, parse: "INVALID_JSON" };
  }
}

// Corpo de uma requisição da fase 2, em memória (nunca gravado).
export interface CapturedBody {
  messages: unknown[];
  hasTools: boolean;
  hasToolChoice: boolean;
  hasResponseFormat: boolean;
  hasReasoning: boolean;
}

const urlOf = (input: Parameters<typeof fetch>[0]): string => (typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

// URL normalizada (new URL(...).toString()), como o adaptador compatível com OpenAI a envia.
export function normalizeUrl(raw: string): string | null {
  try {
    return new URL(raw).toString();
  } catch {
    return null;
  }
}

function hostOf(raw: string): string | null {
  try {
    const host = new URL(raw).host;
    return host === "" ? null : host;
  } catch {
    return null;
  }
}

const describe = (error: unknown) => {
  const e = asLoose(error);
  return sanitize(error instanceof Error ? `${error.name}: ${error.message}` : String(e["message"] ?? error));
};

// Requisição que a camada não delega (latch marcado): o Mastra recebe esta exceção pelo fetch.
export class InstrumentBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstrumentBlocked";
  }
}

// Camada de captura da V3 em duas partes, com o monitor da V2.1 no meio:
//   captura (topo) → monitor da V2.1 → sentinela (base) → fetch original.
// - Topo, nas duas fases: verifica se o host é determinável; na fase 1, da primeira requisição, só
//   conta as mensagens (N); na fase 2, lê o corpo, em memória, para I4, I8 e a comparação B da I10.
// - Base (sentinela): só conta as requisições que passaram pelo monitor. Uma exceção que volta ao
//   topo SEM ter chegado à sentinela é falha do monitor; uma que chegou é erro de rede/provider.
// Latch (failures): qualquer falha do instrumento fica registrada aqui; com o latch marcado, a
// requisição corrente e as seguintes (inclusive as repetições internas do Mastra) NÃO são
// delegadas: nem ao monitor, nem ao fetch. A orquestração confere o latch depois de cada chamada ao
// Agent, antes de classificar, repetir ou pontuar.
export class CaptureLayer {
  phase: 1 | 2 = 1;
  readonly failures: InstrumentFailure[] = [];
  firstPhase1MessageCount: number | null = null;
  readonly phase2Bodies: CapturedBody[] = [];
  // Requisições delegadas pelo topo e requisições que chegaram à sentinela.
  sent = 0;
  reached = 0;
  // Requisições recusadas pelo latch (nunca chegaram ao monitor nem ao servidor).
  blocked = 0;
  // Início e fim de cada requisição delegada, por fase: delimitam os passos em tempo real (o
  // onStepFinish do Mastra pode chegar atrasado; v3/src/provider-path.test.ts).
  readonly requests: { phase: 1 | 2; start: number; end: number | null }[] = [];
  // Chamado no início de cada requisição DE INFERÊNCIA delegada (a orquestração avança o passo do
  // TurnProtocol). Outra rota no mesmo host, ou outro host, não é passo do modelo.
  onDelegate: ((phase: 1 | 2) => void) | undefined;
  private readonly fault: ((phase: 1 | 2) => void) | undefined;
  // URL de inferência de cada fase (inferenceEndpointOf, em run.ts). Sem ela (testes da camada
  // isolada), toda requisição com host determinado conta como de inferência.
  private readonly endpoints: Partial<Record<1 | 2, string | null>> | undefined;

  // `fault`: só para testes (simula exceção da camada numa fase).
  constructor(fault?: (phase: 1 | 2) => void, endpoints?: Partial<Record<1 | 2, string | null>>) {
    this.fault = fault;
    this.endpoints = endpoints;
  }

  // Requisição de inferência: POST para a URL de inferência do provider da fase. Só ela avança o
  // passo, entra na contagem por fase (I4, latência), dá o N e tem o corpo lido na fase 2. Outra
  // rota no mesmo host (ex.: /api/tags) ou outro host seguem ao monitor da V2.1 como qualquer
  // requisição (outro host: registrado como externo, EXEC_EXTERNAL_EFFECT, sem bloqueio).
  isInference(input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1], phase: 1 | 2): boolean {
    const raw = urlOf(input);
    if (hostOf(raw) === null) return false;
    if (this.endpoints === undefined) return true;
    const endpoint = this.endpoints[phase];
    const requestMethod = typeof input === "object" && !(input instanceof URL) ? input.method : undefined;
    const method = (init?.method ?? requestMethod ?? "GET").toUpperCase();
    return typeof endpoint === "string" && method === "POST" && normalizeUrl(raw) === endpoint;
  }

  fail(layer: InstrumentFailure["layer"], phase: 1 | 2 | null, error: unknown): void {
    this.failures.push({ layer, phase, detail: typeof error === "string" ? error : describe(error) });
  }

  private inspect(input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]): void {
    const phase = this.phase;
    this.fault?.(phase);
    if (hostOf(urlOf(input)) === null) this.fail("monitor", phase, `host indeterminado: ${sanitize(urlOf(input)).slice(0, 120)}`);
    if (!this.isInference(input, init, phase)) return;
    const needsBody = phase === 2 || this.firstPhase1MessageCount === null;
    if (!needsBody) return;
    let body: Loose;
    try {
      if (typeof init?.body !== "string") throw new Error("corpo ausente ou não textual");
      body = asLoose(JSON.parse(init.body));
      if (!Array.isArray(body["messages"])) throw new Error("corpo sem messages");
    } catch (error) {
      this.fail("captura", phase, `corpo ilegível: ${describe(error)}`);
      return;
    }
    const messages = body["messages"] as unknown[];
    if (phase === 1) {
      this.firstPhase1MessageCount = messages.length;
      return;
    }
    this.phase2Bodies.push({
      messages,
      hasTools: "tools" in body && body["tools"] !== undefined && body["tools"] !== null,
      hasToolChoice: "tool_choice" in body && body["tool_choice"] !== undefined && body["tool_choice"] !== null,
      hasResponseFormat: "response_format" in body && body["response_format"] !== undefined && body["response_format"] !== null,
      hasReasoning: messages.some((m) => {
        const msg = asLoose(m);
        return "reasoning_content" in msg || "reasoning" in msg || asArray(msg["content"]).some((p) => asLoose(p)["type"] === "reasoning");
      }),
    });
  }

  // Topo: instala a captura sobre o fetch atual (o wrapper do monitor) e a remove em finally.
  async around<T>(fn: () => Promise<T>): Promise<T> {
    const below = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const phase = this.phase;
      if (this.failures.length > 0) {
        this.blocked += 1;
        throw new InstrumentBlocked("requisição bloqueada: falha do instrumento já registrada");
      }
      try {
        this.inspect(input, init);
      } catch (error) {
        this.fail("captura", phase, `exceção da camada: ${describe(error)}`);
        this.blocked += 1;
        throw error;
      }
      // Host indeterminado ou corpo ilegível: registrado no latch; a requisição não é delegada.
      if (this.failures.length > 0) {
        this.blocked += 1;
        throw new InstrumentBlocked(`requisição bloqueada: ${this.failures.at(-1)?.detail ?? "falha do instrumento"}`);
      }
      this.sent += 1;
      const entry = { phase, start: performance.now(), end: null as number | null };
      if (this.isInference(input, init, phase)) {
        this.requests.push(entry);
        this.onDelegate?.(phase);
      }
      const reachedBefore = this.reached;
      let response: Response;
      try {
        response = await below(input, init);
      } catch (error) {
        entry.end = performance.now();
        if (this.reached === reachedBefore) this.fail("monitor", phase, `exceção do monitor: ${describe(error)}`);
        throw error;
      }
      entry.end = performance.now();
      if (this.reached === reachedBefore) this.fail("monitor", phase, "o monitor devolveu resposta sem delegar a requisição ao fetch");
      return response;
    }) as typeof fetch;
    try {
      return await fn();
    } finally {
      globalThis.fetch = below;
    }
  }

  // Base (sentinela): instalada ANTES do monitor, logo acima do fetch original; só conta.
  async aroundBottom<T>(fn: () => Promise<T>): Promise<T> {
    const below = globalThis.fetch;
    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      this.reached += 1;
      return below(input, init);
    }) as typeof fetch;
    try {
      return await fn();
    } finally {
      globalThis.fetch = below;
    }
  }

  requestSummary(): Phase2Request {
    const bodies = this.phase2Bodies;
    return {
      requests: bodies.length,
      anyTools: bodies.some((b) => b.hasTools),
      anyToolChoice: bodies.some((b) => b.hasToolChoice),
      allResponseFormat: bodies.every((b) => b.hasResponseFormat),
      anyReasoning: bodies.some((b) => b.hasReasoning),
    };
  }
}
