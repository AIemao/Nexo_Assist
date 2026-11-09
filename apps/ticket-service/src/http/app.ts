import { setTimeout as sleep } from "node:timers/promises";
import type { HttpBindings } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { zValidator } from "@hono/zod-validator";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";

import type { CreateTicketInput, CreateTicketResult } from "../application/create-ticket.js";
import {
  ACTOR_TYPES,
  AFFECTED_SCOPES,
  COMMITMENT_RISKS,
  PRIORITIES,
  TICKET_CATEGORIES,
  TICKET_TYPES,
  WORK_IMPACTS,
  type Actor,
  type CreateTicketDraft,
} from "../domain/index.js";
import type { SimulatedFault } from "./simulated-fault.js";
import type { WriteRecord } from "./write-record.js";

// Contrato: docs/architecture/04-http-contract.md. Camada fina (ADR-010, condição 5):
// valida a forma, chama o caso de uso e traduz o resultado.

export interface CreateTicketUseCase {
  execute(input: CreateTicketInput): Promise<CreateTicketResult>;
}

export interface AppDependencies {
  createTicket: CreateTicketUseCase;
  onUnexpectedError?: (error: unknown) => void | Promise<void>;
  // Cenários §2.2. Ausente = desligada.
  simulatedFault?: SimulatedFault;
  // Cenários §1.1: recebe um registro por requisição de escrita.
  recordWrite?: (record: WriteRecord) => void;
}

// ---------------------------------------------------------------------------
// Problem Details (RFC 9457; contrato §4.2). Único ponto que monta respostas de erro.

const PROBLEM_TITLES = {
  400: "Bad Request",
  403: "Forbidden",
  409: "Conflict",
  415: "Unsupported Media Type",
  422: "Unprocessable Content",
  500: "Internal Server Error",
} as const;

type ProblemStatus = keyof typeof PROBLEM_TITLES;

interface ValidationError {
  path: string;
  message: string;
}

function problem(status: ProblemStatus, code: string, errors?: ValidationError[]): Response {
  const body = {
    type: "about:blank",
    title: PROBLEM_TITLES[status],
    status,
    code,
    ...(errors === undefined ? {} : { errors }),
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

// ---------------------------------------------------------------------------
// Registro das escritas (cenários §1.1). Quem decide o desfecho deixa estes metadados
// no contexto (IN8); o emissor só os lê, sem deduzir o desfecho pelo status da resposta.

// O registro sem `event`, `operation` e `idempotencyKey`, que o emissor completa.
export type WriteOutcome = Omit<WriteRecord, "event" | "operation" | "idempotencyKey">;

// IN6: a marca vive no contexto da requisição, nunca em estado da instância; sob
// concorrência, cada requisição carrega a sua.
type WriteVariables = { writeOutcome?: WriteOutcome };

// Ambiente mínimo do emissor: só as variáveis de escrita, sem os bindings do Node, para
// que ele funcione também num Hono que não é o deste app.
export type WriteEnv = { Variables: WriteVariables };

type AppEnv = {
  Bindings: HttpBindings;
  Variables: WriteVariables;
};

type AppContext = Context<AppEnv>;

type UnexpectedErrorHandler = (error: unknown) => void | Promise<void>;

// O contexto visto só pelo que a marca usa. A classe Context do Hono não é atribuível
// entre ambientes diferentes; este tipo aceita o contexto de qualquer app cujas variáveis
// incluam a marca (o real e o mínimo dos testes), sem type assertion.
type WriteMarkTarget = { set(key: "writeOutcome", value: WriteOutcome): void };

// Único mecanismo de marca do desfecho.
export function markWrite(c: WriteMarkTarget, writeOutcome: WriteOutcome): void {
  c.set("writeOutcome", writeOutcome);
}

// Resposta de erro (Problem Details) que também marca o desfecho da escrita.
function rejectWrite(
  c: AppContext,
  outcome: "INVALID" | "REJECTED" | "ERROR",
  status: ProblemStatus,
  code: string,
  errors?: ValidationError[],
): Response {
  markWrite(c, { outcome, status, code, responseDisposition: "SENT" });
  return problem(status, code, errors);
}

// Repassa um erro ao registro interno sem nunca alterar a resposta: falha síncrona ou
// promessa rejeitada do próprio onUnexpectedError são descartadas.
function reportUnexpected(onUnexpectedError: UnexpectedErrorHandler, error: unknown): void {
  try {
    // Sem await: a resposta não espera o registro.
    void Promise.resolve(onUnexpectedError(error)).catch(() => {});
  } catch {
    // Uma falha síncrona no registro não pode alterar a resposta.
  }
}

type Rejection = Extract<CreateTicketResult, { ok: false }>["error"];

// Contrato §4.1.
const REJECTION_STATUS: Record<Rejection, ProblemStatus> = {
  ACTOR_NOT_EMPLOYEE: 403,
  IDEMPOTENCY_KEY_CONFLICT: 409,
  INVALID_IMPACT_ASSESSMENT: 422,
  PRIORITY_MISMATCH: 422,
};

// ---------------------------------------------------------------------------
// Schemas. Os catálogos vêm do domínio; nenhuma lista de valores é repetida aqui.

// Contrato §2: schema estrito; DM §3.3 [PRD]: abertura exige título e descrição.
const createTicketDraftSchema = z.strictObject({
  operation: z.literal("CREATE_TICKET"),
  title: z.string().min(1),
  description: z.string().min(1),
  type: z.enum(TICKET_TYPES),
  category: z.enum(TICKET_CATEGORIES),
  impactAssessment: z.strictObject({
    affectedScope: z.enum(AFFECTED_SCOPES),
    workImpact: z.enum(WORK_IMPACTS),
    commitmentRisk: z.enum(COMMITMENT_RISKS),
  }),
  priority: z.enum(PRIORITIES),
  firstResponseDueAt: z.string(),
}) satisfies z.ZodType<CreateTicketDraft>;

// O Hono entrega os nomes dos cabeçalhos em minúsculas.
const IDEMPOTENCY_KEY = "idempotency-key";
const ACTOR_TYPE = "x-actor-type";
const ACTOR_EMPLOYEE_ID = "x-actor-employee-id";
const ACTOR_PREFIX = "x-actor-";

// Nome canônico usado no `path` dos erros (contrato §4.2).
const CANONICAL_HEADER_NAMES: Record<string, string> = {
  [IDEMPOTENCY_KEY]: "Idempotency-Key",
  [ACTOR_TYPE]: "X-Actor-Type",
  [ACTOR_EMPLOYEE_ID]: "X-Actor-Employee-Id",
};

const actorTypeSchema = z.enum(ACTOR_TYPES);

// Contrato §2.2 e DM §3.9: EMPLOYEE e ANALYST exigem o employeeId; SYSTEM não o envia.
const actorHeadersSchema = z.discriminatedUnion(ACTOR_TYPE, [
  z.looseObject({
    [ACTOR_TYPE]: actorTypeSchema.exclude(["SYSTEM"]),
    [ACTOR_EMPLOYEE_ID]: z.string().min(1),
  }),
  z.looseObject({
    [ACTOR_TYPE]: actorTypeSchema.extract(["SYSTEM"]),
    [ACTOR_EMPLOYEE_ID]: z.undefined(),
  }),
]);

// Contrato §2.1: UUID sem aspas. Único schema da chave: a validação de cabeçalhos e o
// emissor do registro (cenários §1.1, IN4) usam este mesmo objeto.
const idempotencyKeySchema = z.uuid();

const idempotencyHeaderSchema = z.looseObject({
  [IDEMPOTENCY_KEY]: idempotencyKeySchema,
});

// Contrato §2.2: conjunto fechado de cabeçalhos X-Actor-*; os demais cabeçalhos são ignorados.
const requestHeadersSchema = z
  .intersection(idempotencyHeaderSchema, actorHeadersSchema)
  .superRefine((headers, ctx) => {
    for (const name of Object.keys(headers)) {
      const lower = name.toLowerCase();
      if (lower.startsWith(ACTOR_PREFIX) && !(lower in CANONICAL_HEADER_NAMES)) {
        ctx.addIssue({ code: "custom", path: [name], message: "Cabeçalho de ator não previsto." });
      }
    }
  });

// O zValidator lê `schema.shape` (ou `schema.in.shape`) do schema de cabeçalhos para
// mapear nomes sem diferença de maiúsculas, e uma interseção não tem `shape`. O objeto
// vazio de entrada só atende a essa leitura: repassa todos os cabeçalhos, já em minúsculas.
const headersValidatorSchema = z.looseObject({}).pipe(requestHeadersSchema);

type RequestHeaders = z.output<typeof requestHeadersSchema>;

function toActor(headers: RequestHeaders): Actor {
  if (headers[ACTOR_TYPE] === "SYSTEM") return { type: "SYSTEM" };
  return { type: headers[ACTOR_TYPE], employeeId: headers[ACTOR_EMPLOYEE_ID] };
}

// ---------------------------------------------------------------------------
// Erros de validação (contrato §4.2). O ZodError nunca é serializado.

function toJsonPointer(path: readonly PropertyKey[]): string {
  const segments = path.map((segment) => `/${String(segment).replaceAll("~", "~0").replaceAll("/", "~1")}`);
  return `#${segments.join("")}`;
}

function toHeaderName(path: readonly PropertyKey[]): string {
  const name = String(path[0] ?? "");
  return CANONICAL_HEADER_NAMES[name.toLowerCase()] ?? name;
}

function toValidationErrors(error: z.core.$ZodError, target: string): ValidationError[] {
  return error.issues.flatMap((issue) => {
    // Campo extra no schema estrito: um erro por campo, no caminho do próprio campo.
    const paths = issue.code === "unrecognized_keys" ? issue.keys.map((key) => [...issue.path, key]) : [issue.path];
    return paths.map((path) => ({
      path: target === "header" ? toHeaderName(path) : toJsonPointer(path),
      message: issue.message,
    }));
  });
}

type ValidationResult = ({ success: true } | { success: false; error: z.core.$ZodError }) & { target: string };

function rejectInvalid(result: ValidationResult, c: AppContext): Response | undefined {
  if (result.success) return undefined;
  return rejectWrite(c, "INVALID", 400, "VALIDATION_ERROR", toValidationErrors(result.error, result.target));
}

// ---------------------------------------------------------------------------
// Content-Type (contrato §2): verificado antes de ler o corpo.

function mediaType(contentType: string | undefined): string | undefined {
  return contentType?.split(";")[0]?.trim().toLowerCase();
}

const requireJson: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (mediaType(c.req.header("content-type")) !== "application/json") {
    return rejectWrite(c, "INVALID", 415, "UNSUPPORTED_MEDIA_TYPE");
  }
  await next();
};

// ---------------------------------------------------------------------------
// Emissor único do registro das escritas (cenários §1.1, IN8). Fica por fora de
// requireJson, validadores e handler: depois do next(), o desfecho já foi marcado por
// quem o decidiu, inclusive pelo onError, que roda dentro do next() (o compose do Hono
// captura a exceção na camada do handler, chama o onError e só então devolve o controle).
// Só observa: não decide regra de negócio (ADR-010, condição 5).

export interface WriteRecorderOptions {
  // Ausente: nada é emitido, mas o diagnóstico de caminho sem marca continua ativo.
  recordWrite?: ((record: WriteRecord) => void) | undefined;
  onUnexpectedError: UnexpectedErrorHandler;
}

export function writeRecorder({ recordWrite, onUnexpectedError }: WriteRecorderOptions): MiddlewareHandler<WriteEnv> {
  return async (c, next) => {
    await next();

    const writeOutcome = c.get("writeOutcome");
    // IN8: todo caminho marca o próprio desfecho. Um caminho sem marca é defeito da
    // instrumentação: não se inventa um desfecho (seria mentir sobre o que aconteceu),
    // mas o defeito aparece no registro interno em vez de a linha sumir em silêncio.
    if (writeOutcome === undefined) {
      reportUnexpected(
        onUnexpectedError,
        new Error(`${c.req.method} ${c.req.path} terminou sem desfecho registrado (cenários §1.1, IN8).`),
      );
      return;
    }
    if (recordWrite === undefined) return;

    // IN4: a chave entra em qualquer desfecho, só se for válida pelo mesmo schema da
    // validação de cabeçalhos, sem depender da ordem dos validadores. Inválida: omitida.
    const key = idempotencyKeySchema.safeParse(c.req.header(IDEMPOTENCY_KEY));

    const record: WriteRecord = {
      event: "ticket_write",
      operation: "CREATE",
      ...writeOutcome,
      ...(key.success ? { idempotencyKey: key.data } : {}),
    };

    // IN8: falha do gravador nunca altera a resposta nem o resultado de negócio. O erro
    // vai para o registro interno, e nenhum segundo registro é emitido.
    try {
      recordWrite(record);
    } catch (error) {
      reportUnexpected(onUnexpectedError, error);
    }
  };
}

// FS5: encerra a conexão sem resposta HTTP e avisa o adapter de que não deve responder.
function dropConnection(outgoing: HttpBindings["outgoing"]): Response {
  outgoing.destroy();
  return RESPONSE_ALREADY_SENT;
}

// ---------------------------------------------------------------------------

export function createApp({
  createTicket,
  onUnexpectedError = console.error,
  simulatedFault,
  recordWrite,
}: AppDependencies) {
  // Bindings do adapter Node: a falha simulada encerra o ServerResponse (c.env.outgoing),
  // o que só existe com @hono/node-server. Os testes de rota (app.request()) não ligam
  // falha e nunca chegam a c.env.
  const app = new Hono<AppEnv>();

  // FS6: estado da instância (uma instância = um processo), consumido pela primeira
  // requisição elegível. Nunca em variável de módulo.
  let faultPending = simulatedFault !== undefined;

  app.post(
    "/tickets",
    // IN3: só esta rota de escrita registra; o emissor envolve todo o resto da cadeia.
    writeRecorder({ recordWrite, onUnexpectedError }),
    requireJson,
    // Genéricos explícitos: o zValidator não infere o ambiente (E) a partir do hook, e o
    // rejectInvalid precisa do contexto tipado para marcar o desfecho.
    zValidator<typeof headersValidatorSchema, "header", AppEnv, "/tickets", typeof rejectInvalid>(
      "header",
      headersValidatorSchema,
      rejectInvalid,
    ),
    async (c) => {
      const headers = c.req.valid("header");

      // Corpo lido aqui, e não pelo zValidator("json"): o validador do Hono testa o
      // Content-Type com uma regex própria, mais restrita que a do requireJson.
      // Só o erro de parse vira 400; qualquer outra falha segue para o onError (500).
      let body: unknown;
      try {
        body = await c.req.json<unknown>();
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        return rejectWrite(c, "INVALID", 400, "VALIDATION_ERROR", [{ path: "#", message: "Corpo JSON malformado." }]);
      }

      const parsed = createTicketDraftSchema.safeParse(body);
      if (!parsed.success) {
        return rejectWrite(c, "INVALID", 400, "VALIDATION_ERROR", toValidationErrors(parsed.error, "json"));
      }

      // FS2: F-DROP-BEFORE age aqui, depois de toda a validação da fronteira HTTP
      // (Content-Type, cabeçalhos e corpo) e antes do caso de uso. As regras de negócio
      // ficam dentro do caso de uso e nunca são avaliadas quando a falha age; nada é gravado.
      // Sem await entre a verificação e a atribuição: no event loop, as duas são atômicas.
      // IN4: marcado antes de agir. Sem status nem code: nada foi produzido.
      if (faultPending && simulatedFault?.mode === "F-DROP-BEFORE") {
        faultPending = false;
        markWrite(c, { outcome: "NOT_EXECUTED", fault: simulatedFault.mode, responseDisposition: "DROPPED" });
        return dropConnection(c.env.outgoing);
      }

      const result = await createTicket.execute({
        idempotencyKey: headers[IDEMPOTENCY_KEY],
        draft: parsed.data,
        actor: toActor(headers),
      });

      if (result.ok) {
        // IN7: CREATED ou REPLAYED vem do caso de uso; 201 é o status produzido ou, no
        // F-DROP-AFTER, o que seria enviado (IN4).
        const success = { outcome: result.outcome, status: 201, ticketId: result.ticket.id };

        // FS3: F-DROP-AFTER age aqui, depois do commit da Unit of Work (o caso de uso já
        // devolveu sucesso, inclusive no replay) e fora dela: perder a resposta antes do
        // commit reverteria a transação e seria outro caso. Marcado antes de agir.
        if (faultPending && simulatedFault?.mode === "F-DROP-AFTER") {
          faultPending = false;
          markWrite(c, { ...success, fault: simulatedFault.mode, responseDisposition: "DROPPED" });
          return dropConnection(c.env.outgoing);
        }
        // FS4: F-SLOW espera aqui, depois do execute, com a transação já encerrada.
        // Nunca dentro da Unit of Work: com a conexão única (ADR-008), uma espera
        // dentro da transação seguraria todas as outras requisições.
        // A falha é consumida e marcada antes do await, para outra requisição não a ver
        // pendente; a resposta sai depois da espera (SENT, IN5).
        if (faultPending && simulatedFault?.mode === "F-SLOW") {
          faultPending = false;
          markWrite(c, { ...success, fault: simulatedFault.mode, responseDisposition: "SENT" });
          await sleep(simulatedFault.delayMs);
        } else {
          markWrite(c, { ...success, responseDisposition: "SENT" });
        }
        // Contrato §3: o corpo é só o ticket; `ok` e `outcome` não são expostos.
        return c.json(result.ticket, 201);
      }
      return rejectWrite(c, "REJECTED", REJECTION_STATUS[result.error], result.error);
    },
  );

  app.onError((error, c) => {
    // Contrato §4.3: corpo genérico; o detalhe fica só no registro interno, que nunca
    // impede a resposta 500.
    reportUnexpected(onUnexpectedError, error);
    // IN8: o caminho do erro marca o próprio desfecho; o emissor não deduz o ERROR do 500.
    return rejectWrite(c, "ERROR", 500, "INTERNAL_ERROR");
  });

  return app;
}
