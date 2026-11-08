# ADR-010 — Framework HTTP do ticket-service: Hono com @hono/node-server

- **Status:** Aceito
- **Data:** 2026-11-07
- **Bloco:** 3

Com que framework o ticket-service expõe sua API HTTP, e sob quais condições?

## Contexto

O ticket-service é a aplicação separada dona do domínio dos chamados (ADR-002). O domínio, a persistência e o caso de uso `createTicket` já existem e não dependem de HTTP. Falta a fronteira HTTP: receber a requisição do web/BFF, validar a forma, chamar o caso de uso e traduzir o resultado.

O framework foi escolhido por um spike comparativo entre Fastify e Hono, feito fora do repositório, com a mesma rota (`POST /tickets`), os mesmos schemas Zod, a mesma resposta e os mesmos testes nos dois candidatos.

## Decisão

**Hono com `@hono/node-server`**, validando com `@hono/zod-validator` e Zod.

**Critérios de seleção**, nesta ordem de prioridade:

1. Testar sem abrir porta.
2. Zod na fronteira, com o tipo inferido chegando ao handler.
3. Compatibilidade com TypeScript 7 e ESM.
4. Poucas peças: menos dependências e aprovações no `allowScripts`.

Os dois candidatos empataram nos critérios 1 e 2. O Hono passou no critério 3 com um ajuste explícito (`"types": ["node"]`), e o Fastify passou com o `@types/node` alcançado por referência transitiva. O critério 4 decidiu: 4 pacotes de runtime contra 58.

**Condições obrigatórias.**

1. **Versões exatas.** Sem `^`, e estáveis publicadas há pelo menos sete dias, salvo correção de segurança que justifique uma versão mais recente.
2. **Testes de rota sem porta.** Sempre com `app.request()`.
3. **Smoke test do servidor real em etapa separada**, fora dos testes de rota.
4. **`"types": ["node"]` explícito no `tsconfig.json` do ticket-service** (ver "Typecheck").
5. **Camada HTTP fina.** Valida a forma da requisição e chama o caso de uso; não contém regras de negócio.
6. **Corpos de erro próprios, em Problem Details** (RFC 9457). Nunca expor diretamente `ZodError`, a resposta nativa do Hono ou detalhes internos do framework. O contrato está em [`04-http-contract.md`](../architecture/04-http-contract.md).

## Alternativas consideradas

### A. Fastify

É a alternativa concorrente mais forte. `app.inject()` atende ao teste sem porta, e a inferência dos tipos do Zod funciona com `@fastify/type-provider-zod`. Foi rejeitada pelo custo de dependências:

- O provider declara `@fastify/swagger` e `openapi-types` como peers obrigatórios, sem `peerDependenciesMeta`; o npm os instala no runtime mesmo sem documentação OpenAPI.
- Resultado medido: 58 pacotes de runtime.

Atende aos critérios funcionais, mas com mais peças do que o Hono.

### B. Express

Não oferece API nativa de injeção equivalente a `app.inject()` ou `app.request()`; o teste sem porta exigiria uma dependência a mais (Supertest). Foi excluído da comparação principal por não atender tão diretamente aos critérios prioritários. Não foi medido no spike.

## Evidências do spike

O spike rodou em 2026-11-07, em `../nexo-http-spike/{fastify,hono}`, fora do repositório, cada aplicação com seu `package.json`, lockfile e `npm ci` próprios. Nada do spike foi commitado.

**Versões testadas.**

| Item | Versão |
| --- | --- |
| Node / npm | 26.13.0 / 11.20.0 |
| Hono | 4.13.14 (publicado em 2026-10-25) |
| `@hono/node-server` | 2.1.5 (publicado em 2026-10-13) |
| `@hono/zod-validator` | 0.9.1 (publicado em 2026-08-31) |
| Zod | 4.6.7 (publicado em 2026-10-12), o mesmo nos dois candidatos |
| TypeScript / Vitest | 7.0.2 / 5.1.0, as versões do lockfile do projeto |
| Fastify | 5.12.8 |
| `@fastify/type-provider-zod` | 1.0.3 |
| `@types/node` | 26.6.6, a versão do lockfile do projeto |

As versões do Hono seguem a regra dos sete dias: `hono` 4.13.15, 4.13.16 e 4.13.17 e `@hono/node-server` 2.1.6 tinham menos de sete dias em 2026-11-07. O `npm ci` com 4.13.14 e 2.1.5 terminou com "found 0 vulnerabilities".

**Dependências e instalação.**

| | Hono (com adaptador Node e `@types/node`) | Fastify (com `@types/node`) |
| --- | --- | --- |
| Pacotes de runtime | **4** (`hono`, `@hono/node-server`, `@hono/zod-validator`, `zod`) | **58**, incluindo `@fastify/swagger` 9.9.3 e `openapi-types` 12.1.3 |
| Pacotes no lockfile | 87 | 139 (contado antes de acrescentar `@types/node`) |
| `npm ci` | código 0, 43 pacotes, 12,5 s | código 0, 97 pacotes; 26,7 s na primeira execução e 22,0 s repetido com cache |
| Avisos de depreciação ou segurança | nenhum | nenhum |
| Mudança no `allowScripts` | nenhuma | nenhuma |

O único script de instalação nos dois lockfiles é o do `fsevents`, opcional, exclusivo do macOS e trazido pelo Vitest; não tem relação com os frameworks. Os tempos do `npm ci` dependem do cache e da rede.

**Testes de rota.**

- Hono: 5/5 aprovados, com `app.request()`, sem porta.
- Fastify: 5/5 aprovados, com `app.inject()`, sem porta.
- Os dois casos: requisição válida chega ao handler com os valores validados (201); quatro requisições inválidas (título vazio, operação desconhecida, tipo de ator inválido, `idempotency-key` vazia) recebem 400 sem chegar ao handler.
- Os dois inferiram os tipos do Zod no handler sem type assertion nem anotação manual. Provas `Exact` no handler (igualdade estrita de tipos que reprova `any`) confirmaram a inferência: trocar o tipo esperado por um mais largo ou por `any` fez o typecheck falhar nos dois.

**Typecheck.**

| | `skipLibCheck: true` (configuração do projeto) | `skipLibCheck: false` |
| --- | --- | --- |
| Hono 4.13.17 sem `@hono/node-server` (primeira rodada) | passou | passou |
| Hono com `@hono/node-server`, sem `"types": ["node"]` | falhou: 2 erros no script do smoke test (`process` inexistente; parâmetro de `close` com `any` implícito) | falhou: 8 erros, 6 deles nos `node:*` das declarações do adaptador |
| Hono com `"types": ["node"]` | **passou** | **passou** |
| Fastify sem `@types/node` | passou | falhou: 35 erros nas declarações do Fastify |
| Fastify com `@types/node` | passou | **passou** |

Com TypeScript 7, o `@types/node` instalado só entra no programa quando algum arquivo o referencia (`/// <reference types="node" />`). No Fastify, ele chega pelo `pino-std-serializers`. No ticket-service atual, chega pelo `vite`, porque o `vitest.config.ts` está no `include`. No spike do Hono, nada o referenciava; por isso a condição 4 torna a dependência explícita em vez de acidental.

**Smoke test com servidor real.** Separado dos testes de rota, que continuam com `app.request()` e sem porta. O smoke test verifica o adaptador em runtime real:

- Hono servido com `@hono/node-server`; `serve()` em `127.0.0.1` com `port: 0` (porta livre escolhida pelo sistema operacional).
- `fetch` real ao `POST /tickets`: requisição válida → 201 com o corpo esperado; requisição inválida → 400.
- O handler foi chamado só pela requisição válida.
- Encerramento por `close()` em `finally`; o processo terminou com código 0 e a porta foi liberada.

## Consequências

**Positivas**
- Quatro pacotes de runtime na fronteira HTTP.
- Teste de rota em memória, com `Request` e `Response` padrão.
- Tipo inferido do Zod no handler, sem assertion.
- Dependência dos tipos do Node declarada explicitamente.

**Negativas e custos**
- O servidor Node é um pacote à parte (`@hono/node-server`).
- A resposta padrão de validação do `@hono/zod-validator` serializa o `ZodError` como string; o tratamento de erro em Problem Details é código nosso (condição 6).
- Publicações frequentes do Hono exigem a regra dos sete dias e versões exatas.
- Sem logger embutido; o Fastify traz o `pino` como dependência.

## E se o produto crescer para 20 mil funcionários?

**Permanece:** a camada HTTP fina, sem regra de negócio, com o domínio e os casos de uso independentes do framework.

**Pode evoluir** (hipótese futura, não decidida por este ADR): várias instâncias do serviço atrás de um balanceador. O gargalo previsível é a persistência (ADR-008), não o framework HTTP. Como o domínio não depende do Hono, trocar o framework afetaria só a camada HTTP.

## Rastreabilidade

- README §5 (stack e princípios), §8 (fronteira de confiança), §9 (idempotência e reconciliação) e §12 #7 e #8.
- Domain Model v2.11: §3.3 (`CreateTicketDraft`) e §3.16 (idempotência).
- ADR-002 (o ticket-service como aplicação separada), ADR-005 (idempotência) e ADR-008 (persistência; conexão única do adapter).
- [`04-http-contract.md`](../architecture/04-http-contract.md) (contrato da fronteira HTTP).
