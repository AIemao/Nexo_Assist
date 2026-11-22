# 04 — Contrato HTTP do ticket-service

> Artefato do Bloco 3, **versão 1.5**, de 2026-11-22 (decisões do autor no plano do web do Bloco 4; ver seção 16, Histórico de versões). A v1.5 acrescenta ao §7.3 uma nota datada com o tratamento das falhas de leitura no cliente web/BFF. A v1.4 explicita no §4.1 e no §11 a posição do 415 na ordem de validação, como o `POST /tickets` já fazia, registra no §14 a limitação das rotas não mapeadas e marca como entregue o registro das leituras (§7.3).
>
> **Hierarquia das fontes:** o `README.md` é a fonte da verdade do projeto; o `01-domain-model.md` é a fonte da verdade do domínio. Este documento **deriva** deles e descreve só a **fronteira HTTP**: rotas, cabeçalhos, códigos de status e formato dos erros. Não redefine regras do domínio; remete ao DM.
>
> Framework e condições da camada HTTP: [ADR-010](../decisions/ADR-010-framework-http.md).

## 1. Escopo

O cliente desta API é o web/BFF (ADR-002). A camada HTTP valida a forma da requisição com Zod, chama o caso de uso e traduz o resultado em status e corpo. Regras de negócio ficam no caso de uso e no domínio (ADR-010, condição 5).

A v1.2 acrescenta as leituras do funcionário: listagem (§8) e consulta detalhada (§9), com as regras comuns no §7; e a leitura do funcionário para o login simulado (§10). Erros das rotas novas: §11. A leitura de classificação e prazo usada pelo `proposeTicketDraft` (README §6) fica fora desta versão (Bloco 5).

Nas seções da v1.2 à v1.4: DM = `01-domain-model.md` v2.17; AF = `03-agent-flow.md` v1.7; cenários = `01-evaluation-scenarios.md` v1.12. Na nota da v1.5 (§7.3): DM = `01-domain-model.md` v2.19; AF = `03-agent-flow.md` v1.9; cenários = `01-evaluation-scenarios.md` v1.15.

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

O `Content-Type` é verificado antes dos cabeçalhos: com `Content-Type` ausente ou diferente de `application/json`, a resposta é 415, mesmo que os cabeçalhos também sejam inválidos (v1.4; a mesma ordem vale para o `POST /employees/lookup`, §11).

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

> **Nota informativa: ator sem `Employee` (v1.3).** Com as FKs para `Employee` da fatia 0 do Bloco 4 ([ADR-008](../decisions/ADR-008-persistencia-prisma.md), atualização de 2026-11-21), um `X-Actor-Employee-Id` sem `Employee` correspondente no `POST /tickets` viola a premissa de identidade confiável (README §8; §2.2) e resulta no 500 `INTERNAL_ERROR` deste §4.3, com o corpo genérico. Nenhum código novo; nenhuma regra alterada.

## 5. Retry e reconciliação

- A política de retry pertence ao cliente web/BFF (README §12 #7). O ticket-service não tem laço de retry.
- Retries da **mesma intenção** reutilizam a mesma chave e o mesmo corpo original. **Nova intenção ou nova confirmação** recebe outra chave.
- Repetir o `POST /tickets` com a mesma chave reconcilia o resultado original; um endpoint de consulta pela chave é opcional e não faz parte do MVP (README §12 #8).

> **Nota informativa: falha simulada.** Com uma falha simulada ativa ([`01-evaluation-scenarios.md`](../evaluation/01-evaluation-scenarios.md) §2.2), o servidor pode encerrar a conexão sem resposta HTTP ou atrasar a resposta. A falha vem desligada por padrão e fica fora do contrato normal: esta nota não altera nenhuma regra deste documento, e nenhum código de status novo é introduzido. Para o cliente, a conexão encerrada sem resposta é um resultado desconhecido, reconciliado repetindo a operação com a mesma chave e o mesmo corpo (acima).

## 6. Diferenças em relação ao Internet-Draft de `Idempotency-Key`

Documento de referência vigente em 2026-11-07: `draft-ietf-httpapi-idempotency-key-header-08` (22/10/2026), Internet-Draft ativo, ainda não RFC. **O Nexo Assist não declara conformidade integral com esse documento.**

| Tema | Internet-Draft (-08) | Nexo Assist |
| --- | --- | --- |
| Sintaxe | Item Structured Header Field cujo valor é uma String, entre aspas (`Idempotency-Key: "8e03978e-…"`) | UUID **sem aspas**, validado com `z.uuid()`; o formato entre aspas é rejeitado com 400 |
| Formato da chave | Recomenda UUID ou identificador aleatório semelhante | Exige UUID |
| Mesma chave, payload diferente | A chave não deve ser reutilizada com outro payload; recomenda 422 | **Sem fingerprint de payload** nesta etapa. O servidor detecta conflito por operação e solicitante (409), mas não detecta mudança de payload quando operação e solicitante são os mesmos: devolve o snapshot original. Por isso o BFF só reutiliza a chave com o mesmo corpo original |
| Requisição concorrente com a mesma chave, ainda em processamento | Recomenda 409 | No mesmo processo, as transações são serializadas (Unit of Work; conexão única do adapter, ADR-008): a segunda requisição recebe o snapshot depois do commit da primeira, com **201**. Não há conformidade com a recomendação de 409 |
| Chave ausente em operação que a exige | Recomenda 400 | 400 `VALIDATION_ERROR` |

## 7. Leituras do funcionário: regras comuns

Valem para `GET /tickets` (§8) e `GET /tickets/{ticketId}` (§9).

### 7.1 Identidade

- A identidade vem da sessão (ADR-004; README §8). O ticket-service a recebe pelos cabeçalhos do §2.2 (`X-Actor-Type`, `X-Actor-Employee-Id`), preenchidos exclusivamente pelo BFF, com as mesmas regras de forma e o mesmo conjunto fechado de `X-Actor-*`.
- Nenhuma rota de leitura aceita identidade por caminho, consulta ou corpo. Exemplo: `GET /tickets?requesterId=EMP-B` é recusado com **400** `VALIDATION_ERROR`, como o `requesterId` no corpo do `POST /tickets` (§2).
- O ticket-service valida o solicitante em toda leitura de funcionário (ADR-004; DM §7.3): só devolve chamados com `requesterId` igual ao `X-Actor-Employee-Id`.
- O ticket-service não verifica se o `X-Actor-Employee-Id` existe no model `Employee`: mantém a confiança no ator informado pelo web (README §8; §2.2). Um id sem chamados recebe a lista vazia (§8) ou a negação (§9).

### 7.2 Ator aceito

- As duas rotas aceitam só `X-Actor-Type: EMPLOYEE` (DM §7.3; DM §7.1, invariante 1). `ANALYST` e `SYSTEM` recebem **403** `ACTOR_NOT_EMPLOYEE`, o mesmo código do §2.2.
- Para `ANALYST`, a recusa decorre do DM §7.1, invariante 2: todo acesso de analista gera `TicketAccessLog`, e estas rotas não o geram. O acesso do analista entra com o console (Bloco 7; ADR-004), em rotas próprias.
- A verificação do ator vem antes de qualquer leitura no banco: um `ANALYST` recebe 403 sem que o ticket-service consulte o chamado pedido.

### 7.3 Repetição, falhas e instrumentação

- As leituras não têm efeito. Não usam `Idempotency-Key`, porque o `IdempotencyRecord` cobre só operações que produziram efeito (DM §3.16; cenários §1.1, IN1), e podem ser repetidas.
- A política de retry das leituras é do cliente web/BFF (§5). O README §9, "Falhas na leitura", prevê retry com backoff curto e, se a falha persistir, aviso de instabilidade sem perder a conversa. **PENDENTE (README §12 #20, Bloco 4):** o tratamento concreto no cliente.
- As falhas simuladas cobrem só escritas (cenários §2.2, FS6). **PENDENTE (README §12 #20):** se as leituras ganham falha simulada para exercitar o retry.
- O registro das leituras (`"event": "ticket_read"`) está especificado nos cenários §1.1, IL1–IL7 (README §12 #21) e foi implementado e testado na fatia 0 do Bloco 4 (cenários §1.1, IL8). Este contrato não define o registro; nada dele chega à resposta HTTP.
- **Nota (2026-11-22).** Decisão do autor (2026-11-22), no plano do web. As duas PENDENTES acima (README §12 #20) ficam decididas assim:
  - **Tratamento no cliente:** o BFF faz retry nas leituras (§8, §9) e no lookup (§10): 2 tentativas extras, backoff de 200 e 600 ms, timeout de 3 s por tentativa, só para 5xx, timeout e erro de conexão, nunca para 4xx.
  - **Sem falha simulada nas leituras:** o mecanismo do ticket-service continua só nas escritas (cenários §2.2, FS6). Os testes do web usam um ticket-service falso.
  - A falha que persiste depois do retry é tratada pela política do web (DM v2.19 §3.15, `TOOL_FAILURE`). Nada muda nas rotas, nos códigos de status nem no formato dos erros.

## 8. `GET /tickets`: listagem dos chamados do funcionário

```http
GET /tickets
X-Actor-Type: EMPLOYEE
X-Actor-Employee-Id: EMP-A
```

Atende à intenção `LIST_MY_TICKETS` (DM §3.12) e à tool `listMyTickets` (README §6). Cenário: SC-04.

### 8.1 Escopo

- Devolve todos os chamados com `requesterId` igual ao `X-Actor-Employee-Id`, de qualquer status: consultar chamados não se limita a abertos (DM §8.5). No SC-04, a listagem inclui `TKT-A2`, `RESOLVED`.
- Não aceita parâmetros de consulta. Qualquer parâmetro é recusado com **400** `VALIDATION_ERROR` (schema estrito, como o corpo do §2).
- Sem paginação no MVP. Se entrar depois, a resposta já é um objeto (§8.2), e o campo novo não quebra o cliente.

### 8.2 Resposta

**200 OK**, sempre, inclusive sem chamados (`"tickets": []`).

Cada item é um **resumo**: o necessário para o seletor do AF §9.1, passo 2 (`TICKET_SELECTOR`, DM §3.8), distinguir os chamados e mostrar o vencido (AF §9.1, passo 5). Descrição, `impactAssessment`, `assignedTo` e os campos de prazo brutos ficam na consulta detalhada (§9), que é a que registra `VIEWED`; aparecer numa lista não cria associação (DM §3.7).

| Campo | Origem |
| --- | --- |
| `id`, `type`, `title`, `category`, `priority`, `status`, `createdAt`, `updatedAt` | `Ticket` (DM §3.2) |
| `resolvedAt` | `Ticket` (DM §3.2); presente só com `status` `RESOLVED`. Nos demais status, o campo é omitido, como no objeto `ticket` do §3 (campo opcional no DM §3.2) |
| `currentDueAt` | Prazo vigente: `nextUpdateDueAt ?? firstResponseDueAt` (DM §3.2) |
| `isOverdue` | `RESOLVED`: `null`. Demais status: `isOverdue(currentDueAt, now)`, com o relógio do ticket-service (DM §8.5.2; §12) |

- `currentDueAt` e `isOverdue` são calculados pelo ticket-service e entregues prontos: as funções de domínio vivem no ticket-service, sem cópia no web (DM §7.2). O web não recalcula.
- `requesterId` não aparece no item: é sempre o próprio ator.

Exemplo com as fixtures do SC-04 (ids e instantes ilustrativos; o seed não fixa ids, cenários §2.1, S3):

```json
{
  "tickets": [
    {
      "id": "INC-2",
      "type": "INC",
      "title": "Notebook lento",
      "category": "HARDWARE",
      "priority": "MEDIUM",
      "status": "WAITING_ANALYST",
      "createdAt": "2026-11-20T14:40:00.000Z",
      "updatedAt": "2026-11-20T14:40:00.000Z",
      "currentDueAt": "2026-11-25T14:40:00.000Z",
      "isOverdue": false
    },
    {
      "id": "INC-1",
      "type": "INC",
      "title": "Senha do SAP não funciona",
      "category": "ACCESS",
      "priority": "MEDIUM",
      "status": "RESOLVED",
      "createdAt": "2026-11-14T15:00:00.000Z",
      "updatedAt": "2026-11-16T15:00:00.000Z",
      "resolvedAt": "2026-11-16T15:00:00.000Z",
      "currentDueAt": "2026-11-18T21:00:00.000Z",
      "isOverdue": null
    }
  ]
}
```

`TKT-B1` não aparece em nenhuma forma (SC-04).

### 8.3 Ordenação

`updatedAt` decrescente, comparando instantes, com desempate por `id` crescente: a mesma ordem dos candidatos de duplicidade (DM §8.5.1). No SC-04, `TKT-A1` (atualizado há 20 min) vem antes de `TKT-A2` (resolvido há 4 dias).

## 9. `GET /tickets/{ticketId}`: consulta detalhada

```http
GET /tickets/INC-20311
X-Actor-Type: EMPLOYEE
X-Actor-Employee-Id: EMP-A
```

Atende à intenção `VIEW_TICKET` (DM §3.12) e à tool `viewMyTicket` (§13). Cenários: SC-05 e SC-19.

### 9.1 Resposta de sucesso

- **200 OK** com o mesmo objeto `ticket` que o `POST /tickets` devolve (§3; todos os campos do DM §3.2), mais `currentDueAt` e `isOverdue`, calculados como no §8.2.
- Como no §3, o corpo é o próprio objeto `ticket`, sem envelope. `currentDueAt` e `isOverdue` ficam dentro desse objeto, no mesmo nível dos campos do DM §3.2. Os dois campos calculados não fazem parte do snapshot persistido nem do corpo do `POST /tickets`. Campos opcionais ausentes (`resolvedAt`, `assignedTo`, `nextUpdateDueAt`, `serviceDeskUpdatedAt`) são omitidos, como no §3.
- O histórico (`TicketEvent`) não entra nesta versão. **PENDENTE (Bloco 6):** os campos que o anexo `TICKET` exibe (AF §9.1, passo 4; DM §3.8); se exigir o histórico, a resposta ganha um campo novo.

### 9.2 Negação idêntica (AF D17)

- Chamado inexistente, chamado de outro funcionário e id malformado recebem a mesma resposta, byte a byte (AF D17 e §9.2, I-3; SC-05; SC-19): **404 Not Found**, `Content-Type: application/problem+json` e este corpo:

  ```json
  {
    "type": "about:blank",
    "title": "Not Found",
    "status": 404,
    "code": "TICKET_NOT_FOUND"
  }
  ```

  - Sem `detail`, sem `instance` e sem repetir o id pedido; nenhum cabeçalho de resposta depende do caso.
  - 404, e não 403: um 403 só para o chamado alheio revelaria a existência dele.
- O caminho não tem validação de formato: um id malformado (por exemplo, `abc`) chega à consulta e recebe a mesma negação. O funcionário não distingue "não existe", "não é seu" e "não é um id". O caso A do SC-19 usa um id bem formado e inexistente (`INC-999999`; cenários §2.1, S9).
- O caso de uso busca o chamado por `id` e `requesterId` juntos, numa única consulta. Os casos de negação percorrem o mesmo caminho e produzem o mesmo resultado (nenhuma linha). **[Inferência]** Isso reduz a diferença de tempo entre eles, mas não garante tempo constante.

### 9.3 Revalidação do foco no handoff (AF D20)

A revalidação do foco (AF §7, D10) usa esta rota, com o ator `EMPLOYEE` dono da conversa. **200** = foco revalidado; **404** `TICKET_NOT_FOUND` = foco inválido ou inacessível, sem distinguir o motivo, e o chamado não aparece em nenhuma superfície do handoff (AF D20). O handoff em si é do Bloco 7.

## 10. `POST /employees/lookup`: leitura do funcionário para o login simulado

Localiza o funcionário pelo e-mail no login simulado do web. O `Employee` pertence ao ticket-service (DM §1); o model e o seed dos funcionários entram no Bloco 4 (cenários §2.1, S7).

```http
POST /employees/lookup
Content-Type: application/json
X-Actor-Type: SYSTEM

{ "email": "ana@nexo.example" }
```

### 10.1 Requisição

- `POST` com o e-mail no corpo, para o e-mail não aparecer na URL nem em logs de acesso (README §8: "Logs sem dados sensíveis desnecessários"). É leitura: sem `Idempotency-Key`, sem efeito e fora do mecanismo de falhas simuladas (cenários §2.2, FS6). Fica fora do registro `ticket_read` e sem registro operacional nesta etapa; o e-mail nunca é registrado (cenários §1.1, IL1; README §12 #22).
- `Content-Type: application/json`, como no §2. Ausente, ou com tipo de mídia diferente: **415** `UNSUPPORTED_MEDIA_TYPE`.
- Corpo com schema estrito: só `email`, string obrigatória. A senha **não** vai ao ticket-service: o login aceita qualquer senha para funcionários do seed (DM §3.1), e essa aceitação fica no web. Um campo `password` no corpo é recusado com **400** `VALIDATION_ERROR`.
- A comparação do e-mail não diferencia maiúsculas de minúsculas e desconsidera espaços nas pontas (DM §3.1): `" Ana@Nexo.example "` encontra o funcionário cadastrado com `ana@nexo.example`.

### 10.2 Respostas

- **200 OK** com o `Employee` do DM §3.1: `id`, `name`, `email`, `department`, `role`. O web usa `id` e `role` para montar a sessão e, depois, os cabeçalhos do §2.2: identidade e papel são estabelecidos no servidor a partir do funcionário e da sessão (README §8).
- **404** `EMPLOYEE_NOT_FOUND`: nenhum funcionário com o e-mail, pela comparação do DM §3.1. Como o e-mail é único (DM §3.1), a busca encontra no máximo um funcionário.

### 10.3 Quem pode chamar

- Só o BFF, no fluxo de login, antes de existir sessão: a autenticação do funcionário fica no web (README §8; ADR-002). Por isso o ator é `X-Actor-Type: SYSTEM` (DM §3.9), sem `X-Actor-Employee-Id` (regra do `Actor`, §2.2). `EMPLOYEE` ou `ANALYST` recebem **403** `ACTOR_NOT_SYSTEM`.
- Não há autenticação entre o BFF e o ticket-service. "Só o BFF" decorre da premissa de confiança do README §8 e não é imposto pelo serviço, como nas demais rotas.

## 11. Erros das rotas da v1.2

O formato do §4.2 (Problem Details, `code`, `errors` nos 400) e o erro interno do §4.3 valem sem mudança (ADR-010, condição 6). A tabela do §4.1 continua sendo a do `POST /tickets`; as rotas novas usam esta:

| Rota | HTTP | Condição | `code` |
| --- | ---: | --- | --- |
| `GET /tickets`, `GET /tickets/{ticketId}` | 400 | Cabeçalho do ator inválido (§2.2) ou parâmetro de consulta não previsto | `VALIDATION_ERROR` |
| `GET /tickets`, `GET /tickets/{ticketId}` | 403 | Ator `ANALYST` ou `SYSTEM` (§7.2) | `ACTOR_NOT_EMPLOYEE` |
| `GET /tickets/{ticketId}` | 404 | Chamado inexistente, de outro funcionário ou id malformado, com corpo idêntico (§9.2) | `TICKET_NOT_FOUND` |
| `POST /employees/lookup` | 400 | Corpo inválido, campo extra (inclusive `password`), JSON malformado ou cabeçalho do ator inválido | `VALIDATION_ERROR` |
| `POST /employees/lookup` | 403 | Ator diferente de `SYSTEM` (§10.3) | `ACTOR_NOT_SYSTEM` |
| `POST /employees/lookup` | 404 | Nenhum funcionário com o e-mail (§10.2) | `EMPLOYEE_NOT_FOUND` |
| `POST /employees/lookup` | 415 | `Content-Type` ausente ou diferente de `application/json` | `UNSUPPORTED_MEDIA_TYPE` |
| todas | 500 | Como no §4.3 | `INTERNAL_ERROR` |

- Ordem de validação: nas rotas com corpo (`POST /tickets` e `POST /employees/lookup`), primeiro o `Content-Type` (415); depois cabeçalhos, parâmetros de consulta ou corpo, o tipo do ator (403) e só então o caso de uso. É a ordem do §4.1 ("Os cabeçalhos são validados antes do corpo", com o 415 antes dos cabeçalhos desde a v1.4), estendida às rotas novas.
- Em `errors`, o `path` de um parâmetro de consulta é o nome precedido de `?` (`"?requesterId"`), ao lado do JSON Pointer do corpo e do nome do cabeçalho (§4.2).

## 12. `isOverdue` de chamado `RESOLVED`

Regra do DM §8.5.2 (v2.16), que resolve o README §12 #19:

| `status` | `isOverdue` na resposta |
| --- | --- |
| `RESOLVED` | `null`: o vencido não se aplica |
| Demais status (DM §3.2) | `isOverdue(currentDueAt, now)`: `true` ou `false` |

- `isOverdue` tem três valores na resposta: `true` (vencido), `false` (no prazo) e `null` (não se aplica). Só `true` conta como vencido, por exemplo para a oferta de analista (AF §9.1, passo 5; `OVERDUE_TICKET`).
- `currentDueAt` continua presente para todo status.
- No SC-04: `TKT-A1` com `isOverdue: false`; `TKT-A2`, `RESOLVED`, com `isOverdue: null`.

## 13. Tool de consulta detalhada: `viewMyTicket`

- A tool de consulta detalhada se chama **`viewMyTicket`** e tem um único parâmetro, `ticketId`, sem parâmetro de identidade (ADR-004). Ela chama o `GET /tickets/{ticketId}` (§9).
- O nome forma o par com `listMyTickets`, como "Listar / ver meus chamados" no README §6. "My" indica que só os chamados do funcionário da sessão estão ao alcance; a segurança não depende do nome (§7.1, §9.2). "view" corresponde à `Intent` `VIEW_TICKET` (DM §3.12), como "list" corresponde a `LIST_MY_TICKETS`.
- O nome pertence ao contrato das tools do web; este documento registra só a correspondência com a rota.

## 14. Pendências

| Pendência | Origem | Bloco |
| --- | --- | --- |
| Tratamento concreto das falhas nas leituras pelo cliente web/BFF; falha simulada nas leituras (§7.3). **Decidida na v1.5** (§7.3, nota de 2026-11-22): retry do BFF nas leituras e no lookup; sem falha simulada nas leituras | README §12 #20 | 4 |
| Campos exibidos pelo anexo `TICKET` e eventual histórico na consulta detalhada (§9.1) | AF §9.1, passo 4; DM §3.8 | 6 |
| Leitura de classificação e prazo usada pelo `proposeTicketDraft` (§1) | README §6 | 5 |

**Limitação conhecida (v1.4).** Rotas não mapeadas, como `GET /tickets/` (id vazio) e `GET /tickets/a/b`, não casam com `GET /tickets/{ticketId}` e recebem o 404 padrão do Hono, em texto, fora do Problem Details e diferente do `TICKET_NOT_FOUND` do §9.2. Decisão da fatia 0 do Bloco 4: manter assim; um tratamento próprio exige decisão de contrato.

## 15. Rastreabilidade

- README §8 (fronteira de confiança), §9 (idempotência e reconciliação), §12 #7 e #8.
- DM v2.11: §3.2 (`requesterId` vem da sessão), §3.3 (`CreateTicketDraft`), §3.9 (`Actor`, `ActorType`) e §3.16 (idempotência, snapshot e conflito).
- ADR-002, ADR-005, ADR-008 (conexão única do adapter) e ADR-010.
- RFC 9457 (Problem Details for HTTP APIs); `draft-ietf-httpapi-idempotency-key-header-08`.
- `01-evaluation-scenarios.md` §2.2 (mecanismo das falhas simuladas).
- v1.2: README §6 (tools), §8 (privacidade e login), §9 ("Falhas na leitura"), §12 #19, #20 e #21; DM v2.16: §1, §3.1 (unicidade e comparação do e-mail), §3.2, §3.7, §3.8, §3.9, §3.12, §3.16, §7.1 (invariantes 1 e 2), §7.2, §7.3, §8.5, §8.5.1 e §8.5.2 (vencido de `RESOLVED`); AF v1.7: D10, D17, D20, §7, §9.1 e §9.2; `01-evaluation-scenarios.md` v1.10: §1.1 (IN1, IN3), §2.1 (S3, S7, S9), §2.2 (FS6), SC-04, SC-05 e SC-19; ADR-004.
- v1.3: README §8 (fronteira de confiança) e §12 #21; ADR-008 (atualização de 2026-11-21: FKs para `Employee`); `01-evaluation-scenarios.md` v1.11, §1.1 (IL1–IL8).
- v1.4: README §12 #21 e §13 ("Evidência do pronto da fatia 0 do Bloco 4"); `01-evaluation-scenarios.md` v1.12, §1.1 (IL8).
- v1.5: README §9 ("Falhas na leitura") e §12 #20; DM v2.19: §3.15 (`TOOL_FAILURE`); `01-evaluation-scenarios.md` v1.15, §2.2 (FS6).

## 16. Histórico de versões

| Versão | Data | Mudanças |
| --- | --- | --- |
| 1.0 | 2026-11-07 | Primeira versão, publicada com a API HTTP do ticket-service (ADR-010): `POST /tickets`, `Idempotency-Key`, ator, respostas de sucesso, erros em Problem Details (inclusive JSON malformado e ordem de validação, §4.1), retry e reconciliação, diferenças em relação ao Internet-Draft |
| 1.1 | 2026-11-08 | Nota informativa em §5: com falha simulada ativa (cenários §2.2), o servidor pode encerrar a conexão sem resposta ou atrasá-la; desligada por padrão; fora do contrato normal. Nenhuma regra alterada. §7 cita a §2.2 dos cenários. Seção de histórico criada |
| 1.2 | 2026-11-20 | Fatia 0 do Bloco 4, conforme as decisões do autor de 2026-11-20. Leituras do funcionário: regras comuns (§7: identidade pelos cabeçalhos do §2.2, só `EMPLOYEE`, repetição, falhas e instrumentação); `GET /tickets` (§8: listagem em resumo, todos os status, sem paginação, ordem por `updatedAt` decrescente; SC-04); `GET /tickets/{ticketId}` (§9: objeto `ticket` mais `currentDueAt` e `isOverdue`; 404 `TICKET_NOT_FOUND` idêntico para inexistente, alheio e malformado, AF D17; revalidação do foco, AF D20; SC-05, SC-19). `POST /employees/lookup` para o login simulado (§10: ator `SYSTEM`, sem senha, e-mail comparado pela regra do DM v2.16 §3.1, 404 `EMPLOYEE_NOT_FOUND`). Erros das rotas novas (§11). `isOverdue` de `RESOLVED` = `null` (§12; DM v2.16 §8.5.2; README §12 #19). Tool `viewMyTicket` (§13). Pendências (§14). Rastreabilidade e histórico renumerados para §15 e §16. `POST /tickets` (§2 a §6) inalterado |
| 1.3 | 2026-11-21 | Fatia 0 do Bloco 4, conforme as decisões do autor de 2026-11-21. Nota informativa no §4.3 (precedente: v1.1): com as FKs para `Employee` (ADR-008, atualização de 2026-11-21), um `X-Actor-Employee-Id` sem `Employee` no `POST /tickets` viola a premissa do README §8 e resulta no 500 `INTERNAL_ERROR` do §4.3. Nenhuma regra alterada. Remissões atualizadas: §1 cita os cenários v1.11; §7.3 e §14 remetem à especificação do registro das leituras (cenários §1.1, IL1–IL7) e mantêm PENDENTE a implementação e os testes (IL8); §10.1 remete ao IL1 (login fora do `ticket_read`, sem registro; e-mail nunca registrado); §15 com a linha da v1.3 |
| 1.4 | 2026-11-21 | Fechamento da fatia 0 do Bloco 4 (PR #33). §4.1 e §11: a posição do 415 na ordem de validação das duas rotas com corpo (`POST /tickets` e `POST /employees/lookup`) fica explícita: `Content-Type` antes dos cabeçalhos (decisão D8 do plano da fatia 0; é o que o `POST /tickets` já fazia). §14: limitação das rotas não mapeadas (`GET /tickets/` e `GET /tickets/a/b` recebem o 404 padrão do Hono, em texto, fora do Problem Details; decisão D3). §7.3 e §14: o registro das leituras deixa de ser pendência (implementado e testado na fatia 0). §1 cita o DM v2.17 e os cenários v1.12; §15 com a linha da v1.4. Nenhum código de status novo |
| 1.5 | 2026-11-22 | Decisões do autor no plano do web do Bloco 4. §7.3: nota datada com o tratamento das falhas de leitura no cliente web/BFF (retry nas leituras e no lookup: 2 tentativas extras, backoff de 200 e 600 ms, timeout de 3 s, só para 5xx, timeout e erro de conexão, nunca para 4xx) e sem falha simulada nas leituras; resolve README §12 #20. §14: a pendência das falhas de leitura passa a decidida, com remissão ao §7.3. §1 cita o DM v2.19, o AF v1.9 e os cenários v1.15 para a nota da v1.5; §15 com a linha da v1.5. Cabeçalho com a versão. Nenhuma rota, código de status ou formato de erro alterado |
