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

interface WriteOutcome {
  outcome: WriteRecord["outcome"];
  status: number;
  code?: string;
  ticketId?: string;
}

type AppEnv = {
  Bindings: HttpBindings;
  Variables: { writeOutcome?: WriteOutcome };
};

type AppContext = Context<AppEnv>;

function markWrite(c: AppContext, writeOutcome: WriteOutcome): void {
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
  markWrite(c, { outcome, status, code });
  return problem(status, code, errors);
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

function writeRecorder(recordWrite: ((record: WriteRecord) => void) | undefined): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    if (recordWrite === undefined) return;

    const writeOutcome = c.get("writeOutcome");
    // Sem desfecho marcado: só as falhas simuladas que encerram a conexão (FS2, FS3),
    // ainda não registradas (NOT_EXECUTED e DROPPED entram com o teste de transporte).
    if (writeOutcome === undefined) return;

    // IN4: a chave entra em qualquer desfecho, só se for válida pelo mesmo schema da
    // validação de cabeçalhos, sem depender da ordem dos validadores. Inválida: omitida.
    const key = idempotencyKeySchema.safeParse(c.req.header(IDEMPOTENCY_KEY));

    const record: WriteRecord = {
      event: "ticket_write",
      operation: "CREATE",
      outcome: writeOutcome.outcome,
      status: writeOutcome.status,
      ...(writeOutcome.code === undefined ? {} : { code: writeOutcome.code }),
      ...(key.success ? { idempotencyKey: key.data } : {}),
      ...(writeOutcome.ticketId === undefined ? {} : { ticketId: writeOutcome.ticketId }),
      responseDisposition: "SENT",
    };

    // IN8: falha do gravador nunca altera a resposta nem o resultado de negócio.
    try {
      recordWrite(record);
    } catch {
      // Engolida de propósito.
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
    writeRecorder(recordWrite),
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
      if (faultPending && simulatedFault?.mode === "F-DROP-BEFORE") {
        faultPending = false;
        return dropConnection(c.env.outgoing);
      }

      const result = await createTicket.execute({
        idempotencyKey: headers[IDEMPOTENCY_KEY],
        draft: parsed.data,
        actor: toActor(headers),
      });

      if (result.ok) {
        // FS3: F-DROP-AFTER age aqui, depois do commit da Unit of Work (o caso de uso já
        // devolveu sucesso, inclusive no replay) e fora dela: perder a resposta antes do
        // commit reverteria a transação e seria outro caso.
        if (faultPending && simulatedFault?.mode === "F-DROP-AFTER") {
          faultPending = false;
          return dropConnection(c.env.outgoing);
        }
        // FS4: F-SLOW espera aqui, depois do execute, com a transação já encerrada.
        // Nunca dentro da Unit of Work: com a conexão única (ADR-008), uma espera
        // dentro da transação seguraria todas as outras requisições.
        // A falha é consumida antes do await, para outra requisição não a ver pendente.
        if (faultPending && simulatedFault?.mode === "F-SLOW") {
          faultPending = false;
          await sleep(simulatedFault.delayMs);
        }
        // IN7: CREATED ou REPLAYED vem do caso de uso. Marcado depois das falhas
        // simuladas: o F-DROP-AFTER sai antes daqui e ainda não é registrado.
        markWrite(c, { outcome: result.outcome, status: 201, ticketId: result.ticket.id });
        // Contrato §3: o corpo é só o ticket; `ok` e `outcome` não são expostos.
        return c.json(result.ticket, 201);
      }
      return rejectWrite(c, "REJECTED", REJECTION_STATUS[result.error], result.error);
    },
  );

  app.onError((error, c) => {
    // Contrato §4.3: corpo genérico; o detalhe fica só no registro interno.
    try {
      // Sem await: a resposta 500 não espera o registro, e uma rejeição é descartada.
      void Promise.resolve(onUnexpectedError(error)).catch(() => {});
    } catch {
      // Uma falha síncrona no registro não pode impedir a resposta 500.
    }
    // IN8: o caminho do erro marca o próprio desfecho; o emissor não deduz o ERROR do 500.
    return rejectWrite(c, "ERROR", 500, "INTERNAL_ERROR");
  });

  return app;
}
