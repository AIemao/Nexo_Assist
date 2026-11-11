# Spike do ADR-009: escolha do modelo LLM

Experimento de **seleção** de modelo para o ADR-009 (README §11, §12 #9). **Não é baseline.** Ainda não existe baseline oficial; a primeira execução da avaliação completa, depois da decisão do ADR-009, será o baseline oficial (README §10; cenários §1). Protocolo, requisitos E1 a E4 e limites de aprovação: [CRITERIA.md](CRITERIA.md) (congelado em 2026-11-11).

Fora dos workspaces do monorepo (`package.json` próprio; os workspaces da raiz cobrem só `apps/*`).

## Fases

- **Fase 1 (esta):** preparar o experimento. Congelada em 2026-11-11 (manifesto SHA-256 no CRITERIA.md). Nenhum modelo foi executado.
- **Fase 2:** verificar a integração Mastra/provider em execução (E2), conferir os requisitos E1, E3 e E4, executar os 18 resultados por modelo e avaliar contra o CRITERIA.md.

## Conteúdo

| Arquivo | O que é |
| --- | --- |
| `src/prompt.ts` | Prompt de sistema do agent, idêntico para os três modelos |
| `src/schema.ts` | Interpretação do DM v2.13 §3.12 em Zod (catálogos copiados do DM, com a fonte) |
| `src/models.ts` | Configuração dos três modelos (só declaração, nada executa) |
| `src/fixtures.ts` | Artigos e chamados das fixtures dos cenários (§2); normalização de texto livre |
| `src/tools.ts` | Quatro tools de negócio falsas e determinísticas, com registro de chamadas por sessão e os schemas de entrada exportados |
| `cases.json` | 6 entradas com gabaritos, fontes, histórico gravado (C4, C5) e classificação (fiel ou derivado) |
| `src/cases-schema.ts` | Formato dos gabaritos |
| `src/check-cases.ts` | Valida `cases.json` contra o formato, os catálogos e os schemas das tools (`npm run check:cases`) |
| `CRITERIA.md` | Protocolo, requisitos eliminatórios, limites de aprovação, critérios classificatórios e hashes |

```bash
npm ci                 # usa o package-lock.json
npm run typecheck
npm run check:cases
```

`.env` é ignorado pelo git (`.gitignore` da raiz). `.env.example` traz só os nomes: `GROQ_API_KEY`, `MODEL`, `OLLAMA_BASE_URL`.

## Dependências

Resolvidas em 2026-11-09T16:48Z e reajustadas em 2026-11-10. Regra: versões exatas e nenhuma publicada há menos de 7 dias, inclusive as transitivas. O `.npmrc` fixa `before=2026-11-02T00:00:00.000Z`. Conferência dos pacotes do `package-lock.json` no registro: ver "Verificação das datas".

| Pacote | Versão | Publicação (registro npm) | Observação |
| --- | --- | --- | --- |
| `@mastra/core` | 1.81.0 | 2026-10-30T23:22Z | 1.82.0 (2026-11-04) descartada pela regra dos 7 dias. `engines.node >=22.13.0`; peer `zod ^3.25.0 \|\| ^4.0.0`; inclui as especificações de provider v5, v6 e v7 |
| `@ai-sdk/groq` | 4.0.74 | 2026-10-30T15:38Z | 4.0.75 (2026-11-02T20:28Z) descartada pela regra dos 7 dias. `@ai-sdk/provider 4.0.35` (especificação v7, aceita pelo Mastra 1.81.0); peer `zod ^3.25.76 \|\| ^4.1.8`; `engines.node >=22` |
| `zod` | 4.6.7 | 2026-10-12T16:29Z | A mesma do ticket-service (ADR-010) |
| `typescript` | 7.0.2 | 2026-07-08T15:55Z | A mesma do ticket-service |
| `@types/node` | 26.6.6 | 2026-10-28T18:36Z | A mesma do ticket-service |

**Removidos na revisão:** `ollama-ai-provider-v2` 4.1.0 (2026-10-22) e `ai` 7.0.159 (2026-10-30), que só entrava como peer dele. O caminho principal do Ollama passou a ser o endpoint compatível com OpenAI pelo model router do Mastra, que não precisa de nenhum dos dois.

**Node:** o projeto adota Node 26 (`.nvmrc`; `engines` da raiz `>=26`); usado 26.13.0. Todos os `engines` acima aceitam Node 26.

**Fonte das datas e dependências:** `npm view <pacote> time` e `npm view <pacote>@<versão> dependencies peerDependencies engines`, no registro `registry.npmjs.org`.

## Providers

### Documentação consultada (2026-11-09)

- https://mastra.ai/models e https://mastra.ai/models/providers: índice de providers; servidores locais por endpoint compatível com OpenAI (exemplo com LMStudio).
- https://mastra.ai/models/providers/groq: Groq pelo roteador de modelos (`"groq/<modelo>"`, `GROQ_API_KEY`). A página geral mostra também `import { groq } from '@ai-sdk/groq'` como alternativa.
- https://mastra.ai/models/providers/ollama-cloud: só o Ollama Cloud (`OLLAMA_API_KEY`).
- https://mastra.ai/docs/agents/structured-output.md e https://mastra.ai/reference/agents/generate.md: `structuredOutput: { schema }`, resultado em `response.object`; `modelSettings`; `providerOptions`.
- README do `ollama-ai-provider-v2` 4.1.0 (por `npm view`; a página do npmjs.com respondeu 403) e do `@ai-sdk/groq` 4.0.74 (por `npm view`).
- Tipos e código instalados (`node_modules/*/dist`), para o que a documentação não diz.

As páginas do Mastra não mostram versão nem data.

### Ollama: caminho principal

Endpoint compatível com OpenAI do Ollama, pelo model router do Mastra com `url` (o caminho que o Mastra documenta para servidores locais). No Mastra 1.81.0, o tipo `OpenAICompatibleConfig` aceita `{ id: "<provider>/<modelo>", url, apiKey?, headers? }`; `src/models.ts` usa `{ id: "ollama/<modelo>", url: "http://localhost:11434/v1" }` (ou `OLLAMA_BASE_URL`).

- **Contexto:** o endpoint compatível com OpenAI não recebe `num_ctx`. O servidor roda com `OLLAMA_CONTEXT_LENGTH=8192`, conferido na coluna `CONTEXT` do `ollama ps`.
- **Temperatura, seed e limite de saída:** pelo `modelSettings` do Mastra (`temperature`, `seed`, `maxOutputTokens`; o `seed` existe no tipo do `modelSettings` do Mastra 1.81.0). Se chegam ao Ollama pelo endpoint compatível com OpenAI é verificação da Fase 2.

**Divergência registrada:** a premissa inicial do spike citava o `ollama-ai-provider-v2` como "indicado pela documentação do Mastra", mas a documentação atual do Mastra não cita esse pacote. Para Ollama ela só tem o Ollama Cloud; para servidores locais, o endpoint compatível com OpenAI.

### Ollama: alternativa documentada (não instalada)

O `ollama-ai-provider-v2` 4.1.0 continua como alternativa, sem estar no `package.json`. Pela leitura do README e do código dele: tools pelo AI SDK 7; saída estruturada convertida para `format: <JSON Schema>` do Ollama (não documentada no README); opções nativas por `providerOptions.ollama.options` (`seed`, `num_ctx`) e `think` por `providerOptions.ollama.think`; o limite de saída sai como `max_output_tokens`, não como `num_predict`. Exige o pacote `ai` 7 como peer.

### Groq

`@ai-sdk/groq` 4.0.74 (`src/models.ts`, `createGroq` com `GROQ_API_KEY` do ambiente). O roteador de modelos do Mastra (`"groq/openai/gpt-oss-120b"`) é a alternativa documentada pelo Mastra.

- Tools: chamadas de função da API do Groq.
- Saída estruturada sem tools: `response_format` com `json_schema`.
- Saída estruturada **com** tools na mesma chamada: o provider acrescenta a tool sintética `json`, cuja entrada é o schema. O CRITERIA.md trata essa tool como mecanismo de saída estruturada, não como tool de negócio.
- Opções: `reasoningFormat` (`parsed` \| `raw` \| `hidden`), `reasoningEffort`, `parallelToolCalls`; `seed` é repassado à API.

### Mastra: saída estruturada com tools

A documentação avisa: "When an agent has both tools and structured output configured, some models may not support using both features together. This is a limitation of the underlying model APIs, not Mastra itself." Alternativas documentadas: `jsonPromptInjection`; um modelo separado de estruturação (`structuredOutput: { schema, model }`, que faz duas chamadas); `prepareStep`.

### Compatibilidade: o que está e o que não está verificado

- **Verificado na Fase 1:** a forma das configurações dos três modelos (`src/models.ts`) e das tools (`src/tools.ts`) contra os tipos do Mastra 1.81.0 (typecheck).
- **Não verificado (E2, Fase 2):** que cada modelo, dentro do agent Mastra, entregue a interpretação estruturada e chame as tools no mesmo turno. **O typecheck não comprova o E2.**

O `@mastra/core` 1.81.0 também exporta `./test-utils/llm-mock`, relevante para o dublê dos testes determinísticos do web; o spike não o usa.

### Verificações da Fase 2

1. E2: saída estruturada + tools num mesmo turno, em cada modelo (incluindo a tool sintética `json` do Groq e o `response_format` junto com `tools` no endpoint compatível com OpenAI do Ollama).
2. Se `seed`, `temperature 0` e o limite de saída chegam a cada provider (registrar N/A quando não).
3. Controle do raciocínio: se o caminho usado oferece um parâmetro para desligá-lo (`qwen3:8b` pelo endpoint compatível com OpenAI; `reasoningFormat` no Groq). O prompt é o mesmo para todos os modelos, sem ajuste por modelo (nada de `/no_think`). Se não houver como desligar, isso é registrado, e o raciocínio que vazar conta como falha (CRITERIA.md).
4. `tool_choice`: o endpoint compatível com OpenAI do Ollama não declara suporte. Verificar se o Mastra o envia e como o Ollama reage.
5. Contexto do servidor Ollama em 8192 (`ollama ps`).
6. E1, E3 e E4 do Groq: conta sem cartão, termos e reconsulta dos limites da cota gratuita. Com os limites lidos no painel em 2026-11-09 (30 RPM, 1.000 RPD, 8.000 TPM, 200.000 TPD), o Groq não atende ao E4 (CRITERIA.md, "Groq contra o E4") e segue só como referência.

## Verificação das datas

Em 2026-11-10, os 170 pacotes distintos do `package-lock.json` (diretos e transitivos, inclusive os aninhados) foram conferidos no registro: nenhum foi publicado depois de 2026-11-02T16:48Z (o corte de 7 dias na data da primeira resolução). O mais recente é `jose@6.2.15` (2026-11-01T22:28Z).
