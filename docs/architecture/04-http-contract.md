# 04 — Contrato HTTP do ticket-service

> Artefato do Bloco 3, **versão 1.0** (2026-11-07).
>
> **Hierarquia das fontes:** o `README.md` é a fonte da verdade do projeto; o `01-domain-model.md` é a fonte da verdade do domínio. Este documento **deriva** deles e descreve só a **fronteira HTTP**: rotas, cabeçalhos, códigos de status e formato dos erros. Não redefine regras do domínio; remete ao DM.
>
> Framework e condições da camada HTTP: [ADR-010](../decisions/ADR-010-framework-http.md).

## 1. Escopo

O cliente desta API é o web/BFF (ADR-002). A camada HTTP valida a forma da requisição com Zod, chama o caso de uso e traduz o resultado em status e corpo. Regras de negócio ficam no caso de uso e no domínio (ADR-010, condição 5).

## 2. `POST /tickets`

Cria um chamado a partir do rascunho confirmado pelo funcionário.

```http
POST /tickets
Content-Type: application/json
Idempotency-Key: 8e03978e-40d5-43e8-bc93-6894a57f9324
X-Actor-Type: EMPLOYEE
X-Actor-Employee-Id: EMP-001
```

**Corpo:** `CreateTicketDraft`, conforme DM §3.3 (campos e regras de prioridade e prazo). O formato é validado na fronteira; a revalidação da prioridade e o recálculo do prazo são do caso de uso.

- **Schema estrito.** Campo não previsto no `CreateTicketDraft` é rejeitado com **400** `VALIDATION_ERROR`, em vez de ser descartado. Exemplo: `requesterId` no corpo é recusado, porque vem da sessão e nunca do rascunho (DM §3.2; o `CreateTicketDraft` do DM §3.3 não tem esse campo).
- **`Content-Type`.** Ausente, ou com tipo de mídia diferente de `application/json`: **415** `UNSUPPORTED_MEDIA_TYPE`.

### 2.1 `Idempotency-Key`

O valor é um **UUID sem aspas**:

```http
Idempotency-Key: 8e03978e-40d5-43e8-bc93-6894a57f9324
```

- O cabeçalho é validado com `z.uuid()`.
- Qualquer outro formato é rejeitado com **400** e `code: "VALIDATION_ERROR"`, inclusive strings que não são UUID e UUIDs entre aspas (o formato do Internet-Draft; ver seção 6).
- Ausência do cabeçalho também é **400** `VALIDATION_ERROR`.
- Nos erros desse cabeçalho, o `path` em `errors` é `"Idempotency-Key"`.
- O valor é a chave do `IdempotencyRecord` (DM §3.16); as regras de reutilização, snapshot e conflito estão no DM.

### 2.2 Ator

```http
X-Actor-Type: EMPLOYEE
X-Actor-Employee-Id: EMP-001
```

- Os cabeçalhos são preenchidos **exclusivamente pelo BFF**, com os dados da sessão autenticada. Valores enviados diretamente pelo navegador não são confiáveis: o BFF remove ou sobrescreve valores externos com esses nomes.
- A autenticação pertence ao web/BFF; o ticket-service confia no ator informado pelo web (README §8).
- `X-Actor-Type`: `EMPLOYEE`, `ANALYST` ou `SYSTEM` (`ActorType`, DM §3.9).
- `EMPLOYEE` e `ANALYST` exigem `X-Actor-Employee-Id`. `SYSTEM` não envia `X-Actor-Employee-Id`. A regra é a do tipo `Actor` (DM §3.9).
- **Ator malformado** (tipo fora do catálogo, `employeeId` ausente para `EMPLOYEE` ou `ANALYST`, presente para `SYSTEM`) é rejeitado pela validação Zod com **400** `VALIDATION_ERROR`.
- **Conjunto fechado.** Os cabeçalhos do ator são só `X-Actor-Type` e `X-Actor-Employee-Id`; qualquer outro cabeçalho `X-Actor-*` é rejeitado com **400** `VALIDATION_ERROR` (schema estrito). Cabeçalhos HTTP comuns (`User-Agent`, `Accept` e outros) não são afetados.
- **Ator estruturalmente válido que não pode criar chamado** (`ANALYST` ou `SYSTEM`) recebe **403** `ACTOR_NOT_EMPLOYEE`.

## 3. Respostas de sucesso

| Situação | Status | Corpo |
| --- | --- | --- |
| Criação | **201 Created** | o objeto `ticket` |
| Repetição com a mesma chave depois da operação original concluída | **201 Created** | exatamente o mesmo corpo da resposta original |

- O corpo HTTP é **somente o objeto `ticket`** do snapshot. O discriminante interno `ok` do resultado do caso de uso não é exposto: o status HTTP indica sucesso.
- Não há marcador de repetição (`replayed`) na resposta.
- O snapshot persistido pelo caso de uso continua sendo `{ ok: true, ticket }` (DM §3.16). O adaptador HTTP projeta só `ticket` para o corpo, na criação e na repetição.

## 4. Erros

### 4.1 Mapeamento

| HTTP | Condição | `code` |
| ---: | --- | --- |
| 400 | Corpo ou cabeçalhos inválidos na validação Zod, inclusive campo extra no corpo ou cabeçalho `X-Actor-*` não previsto | `VALIDATION_ERROR` |
| 400 | Corpo que não é JSON válido (JSON malformado), com `path` `"#"` em `errors` | `VALIDATION_ERROR` |
| 403 | Ator válido, mas diferente de `EMPLOYEE` | `ACTOR_NOT_EMPLOYEE` |
| 409 | Chave vinculada a outra operação ou outro solicitante | `IDEMPOTENCY_KEY_CONFLICT` |
| 415 | `Content-Type` ausente ou diferente de `application/json` | `UNSUPPORTED_MEDIA_TYPE` |
| 422 | `impactAssessment` inválido | `INVALID_IMPACT_ASSESSMENT` |
| 422 | Prioridade do rascunho diverge da recalculada | `PRIORITY_MISMATCH` |
| 500 | Dado corrompido, erro de banco ou exceção inesperada | `INTERNAL_ERROR` |

Os códigos 403, 409 e 422 correspondem aos resultados de rejeição do caso de uso `createTicket`; o 400 e o 415 são da validação de forma na fronteira; o 500 cobre toda exceção não mapeada.

Os cabeçalhos são validados antes do corpo. Com cabeçalho inválido, o corpo não é lido nem validado, e `errors` traz só os erros de cabeçalho.

### 4.2 Formato: Problem Details (RFC 9457)

Todos os erros usam:

```http
Content-Type: application/problem+json
```

O corpo preserva os membros padrão aplicáveis (`type`, `title`, `status`) e acrescenta a extensão `code`. Enquanto não houver tipos de problema próprios documentados, `type` é `"about:blank"` e `title` é o título do status HTTP.

```json
{
  "type": "about:blank",
  "title": "Unprocessable Content",
  "status": 422,
  "code": "PRIORITY_MISMATCH"
}
```

**Erros 400** acrescentam a extensão da aplicação `errors`:

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "code": "VALIDATION_ERROR",
  "errors": [
    { "path": "#/title", "message": "O título é obrigatório." },
    { "path": "Idempotency-Key", "message": "Deve ser um UUID." }
  ]
}
```

- `path` identifica o campo inválido: JSON Pointer para campos do corpo (`#/title`); o nome canônico do cabeçalho para cabeçalhos (`"Idempotency-Key"`, `"X-Actor-Type"`, `"X-Actor-Employee-Id"`).
- As mensagens dos exemplos são ilustrativas.
- O `ZodError` nunca é serializado diretamente.

### 4.3 Erro interno (500)

Qualquer exceção não mapeada explicitamente produz:

```json
{
  "type": "about:blank",
  "title": "Internal Server Error",
  "status": 500,
  "code": "INTERNAL_ERROR"
}
```

Inclui, entre outros: `CorruptedRecordError`; erros de banco; `P2002` de restrição diferente da chave de idempotência; exceções inesperadas.

O corpo é genérico. Não inclui mensagem interna da exceção, stack trace, SQL, código ou metadados do Prisma, nem detalhes do framework.

O cliente pode repetir uma operação que recebeu 500 com a **mesma chave e o mesmo corpo original**. A idempotência evita efeito duplicado se a operação anterior tiver sido confirmada, mas não garante sucesso quando a causa do erro é persistente.

## 5. Retry e reconciliação

- A política de retry pertence ao cliente web/BFF (README §12 #7). O ticket-service não tem laço de retry.
- Retries da **mesma intenção** reutilizam a mesma chave e o mesmo corpo original. **Nova intenção ou nova confirmação** recebe outra chave.
- Repetir o `POST /tickets` com a mesma chave reconcilia o resultado original; um endpoint de consulta pela chave é opcional e não faz parte do MVP (README §12 #8).

## 6. Diferenças em relação ao Internet-Draft de `Idempotency-Key`

Documento de referência vigente em 2026-11-07: `draft-ietf-httpapi-idempotency-key-header-08` (22/10/2026), Internet-Draft ativo, ainda não RFC. **O Nexo Assist não declara conformidade integral com esse documento.**

| Tema | Internet-Draft (-08) | Nexo Assist |
| --- | --- | --- |
| Sintaxe | Item Structured Header Field cujo valor é uma String, entre aspas (`Idempotency-Key: "8e03978e-…"`) | UUID **sem aspas**, validado com `z.uuid()`; o formato entre aspas é rejeitado com 400 |
| Formato da chave | Recomenda UUID ou identificador aleatório semelhante | Exige UUID |
| Mesma chave, payload diferente | A chave não deve ser reutilizada com outro payload; recomenda 422 | **Sem fingerprint de payload** nesta etapa. O servidor detecta conflito por operação e solicitante (409), mas não detecta mudança de payload quando operação e solicitante são os mesmos: devolve o snapshot original. Por isso o BFF só reutiliza a chave com o mesmo corpo original |
| Requisição concorrente com a mesma chave, ainda em processamento | Recomenda 409 | No mesmo processo, as transações são serializadas (Unit of Work; conexão única do adapter, ADR-008): a segunda requisição recebe o snapshot depois do commit da primeira, com **201**. Não há conformidade com a recomendação de 409 |
| Chave ausente em operação que a exige | Recomenda 400 | 400 `VALIDATION_ERROR` |

## 7. Rastreabilidade

- README §8 (fronteira de confiança), §9 (idempotência e reconciliação), §12 #7 e #8.
- DM v2.11: §3.2 (`requesterId` vem da sessão), §3.3 (`CreateTicketDraft`), §3.9 (`Actor`, `ActorType`) e §3.16 (idempotência, snapshot e conflito).
- ADR-002, ADR-005, ADR-008 (conexão única do adapter) e ADR-010.
- RFC 9457 (Problem Details for HTTP APIs); `draft-ietf-httpapi-idempotency-key-header-08`.
