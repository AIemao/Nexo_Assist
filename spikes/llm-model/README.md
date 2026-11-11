# Spike do ADR-009: escolha do modelo LLM

Experimento de **seleção** de modelo para o ADR-009 (README §11, §12 #9). **Não é baseline.** Ainda não existe baseline oficial; a primeira execução da avaliação completa, depois da decisão do ADR-009, será o baseline oficial (README §10; cenários §1). Protocolo, requisitos E1 a E4 e limites de aprovação: [CRITERIA.md](CRITERIA.md) (congelado em 2026-11-11).

Fora dos workspaces do monorepo (`package.json` próprio; os workspaces da raiz cobrem só `apps/*`).

## Fases

- **Fase 1 (esta):** preparar o experimento. Congelada em 2026-11-11 (manifesto SHA-256 no CRITERIA.md). Nenhum modelo foi executado.
- **Fase 2:** verificar a integração Mastra/provider em execução (E2), conferir os requisitos E1, E3 e E4, executar os 18 resultados por modelo e avaliar contra o CRITERIA.md.

## Conteúdo

| Arquivo               | O que é                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/prompt.ts`       | Prompt de sistema do agent, idêntico para os três modelos                                                                |
| `src/schema.ts`       | Interpretação do DM v2.13 §3.12 em Zod (catálogos copiados do DM, com a fonte)                                           |
| `src/models.ts`       | Configuração dos três modelos (só declaração, nada executa)                                                              |
| `src/fixtures.ts`     | Artigos e chamados das fixtures dos cenários (§2); normalização de texto livre                                           |
| `src/tools.ts`        | Quatro tools de negócio falsas e determinísticas, com registro de chamadas por sessão e os schemas de entrada exportados |
| `cases.json`          | 6 entradas com gabaritos, fontes, histórico gravado (C4, C5) e classificação (fiel ou derivado)                          |
| `src/cases-schema.ts` | Formato dos gabaritos                                                                                                    |
| `src/check-cases.ts`  | Valida `cases.json` contra o formato, os catálogos e os schemas das tools (`npm run check:cases`)                        |
| `CRITERIA.md`         | Protocolo, requisitos eliminatórios, limites de aprovação, critérios classificatórios e hashes                           |

```bash
npm ci                 # usa o package-lock.json
npm run typecheck
npm run check:cases
```

`.env` é ignorado pelo git (`.gitignore` da raiz). O `.env.example` traz:

- `GROQ_API_KEY=` (vazia, para preencher);
- `# OLLAMA_BASE_URL=http://localhost:11434/v1`, comentada.

`OLLAMA_BASE_URL` deve ficar **ausente ou preenchida, nunca vazia**. O `src/models.ts` (congelado) lê `process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434/v1"`. O `??` só cai no padrão quando a variável não existe; uma linha `OLLAMA_BASE_URL=` define a string vazia, que o `??` mantém. Com `url: ""`, o model router do Mastra trata `ollama/<modelo>` como provider de gateway e falha com "Could not find config for provider ollama", antes de qualquer requisição. O `run.ts` e o `probe.ts` detectam esse caso e abortam com mensagem clara. A variável `MODEL`, que existia no `.env.example` congelado na Fase 1, não é lida por nenhum script e saiu.

## Dependências

Resolvidas em 2026-11-09T16:48Z e reajustadas em 2026-11-10. Regra: versões exatas e nenhuma publicada há menos de 7 dias, inclusive as transitivas. O `.npmrc` fixa `before=2026-11-02T00:00:00.000Z`. Conferência dos pacotes do `package-lock.json` no registro: ver "Verificação das datas".

| Pacote         | Versão | Publicação (registro npm) | Observação                                                                                                                                                                                 |
| -------------- | ------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@mastra/core` | 1.81.0 | 2026-10-30T23:22Z         | 1.82.0 (2026-11-04) descartada pela regra dos 7 dias. `engines.node >=22.13.0`; peer `zod ^3.25.0 \|\| ^4.0.0`; inclui as especificações de provider v5, v6 e v7                           |
| `@ai-sdk/groq` | 4.0.74 | 2026-10-30T15:38Z         | 4.0.75 (2026-11-02T20:28Z) descartada pela regra dos 7 dias. `@ai-sdk/provider 4.0.35` (especificação v7, aceita pelo Mastra 1.81.0); peer `zod ^3.25.76 \|\| ^4.1.8`; `engines.node >=22` |
| `zod`          | 4.6.7  | 2026-10-12T16:29Z         | A mesma do ticket-service (ADR-010)                                                                                                                                                        |
| `typescript`   | 7.0.2  | 2026-07-08T15:55Z         | A mesma do ticket-service                                                                                                                                                                  |
| `@types/node`  | 26.6.6 | 2026-10-28T18:36Z         | A mesma do ticket-service                                                                                                                                                                  |

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

## Fase 2a: execução e pontuação

Arquivos novos, fora do manifesto congelado (que continua intacto):

| Arquivo                                | O que é                                                                                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/run.ts`                           | Executa um modelo: aquecimento + 6 casos × 3 repetições, com o agent do Mastra, o prompt, as tools falsas e a interpretação estruturada congelados. Confere o manifesto antes de executar e aborta se algum hash divergir |
| `src/run-record.ts`                    | Formato do registro de cada turno e códigos `EXEC_*`/`SEM_*`                                                                                                                                                              |
| `src/score.ts`                         | Pontuação pura de um turno contra o gabarito e agregação dos 18 resultados, pelas regras do CRITERIA.md                                                                                                                   |
| `src/score.test.ts`, `src/run.test.ts` | Testes (`node:test`); o do run usa o dublê do Mastra (`MastraLanguageModelV2Mock`), sem modelo real                                                                                                                       |
| `src/probe.ts`                         | Sondagem de capacidades (raciocínio, seed, limite de saída), com entradas próprias, fora dos casos C1–C6                                                                                                                  |
| `.gitignore`                           | Logs (`*.log`) e capturas cruas (`results/**/raw/`) fora do versionamento                                                                                                                                                 |

O `package.json` está no manifesto, então não ganhou scripts novos:

```bash
node --test src/score.test.ts src/run.test.ts
node --env-file=.env src/run.ts --model "ollama qwen3:4b-instruct"   # Fase 2b
```

Os rótulos válidos de `--model` são os de `src/models.ts`. O script lê as variáveis do ambiente e não abre o `.env` por conta própria.

**Saída:** `results/<modelo>/<instante>.jsonl` (uma linha de cabeçalho com pacotes, manifesto, parâmetros e aquecimento; depois as 18 linhas de turno) e `results/<modelo>/<instante>-summary.md` (limites, turnos, latência fria e aquecida, tokens, 429, contexto). Os registros não guardam segredos nem cabeçalhos: do `Retry-After` fica só `retryAfterSeconds`, as mensagens de erro têm as chaves mascaradas e nenhum conteúdo de raciocínio é gravado (ver "Política de `results/`").

**Por turno:** chamadas de tool de negócio (nome, argumentos, recusada ou executada), tool sintética `json` do Groq à parte, outros nomes de tool, registro das tools falsas, interpretação crua e resultado do Zod, texto final, presença de raciocínio (separado ou vazado, nunca o conteúdo), tokens de entrada e saída por chamada e no total, latência por chamada e do turno, tentativas, respostas 429, verificação de contexto, requisições a hosts fora do endpoint do modelo e o motivo de falha (atribuído pelo `score.ts`).

**Latência por chamada:** tempo entre o fim do passo anterior do agent (ou o início do turno) e o fim do passo, medido pelo `onStepFinish` do Mastra. Inclui a execução das tools falsas, que é desprezível.

**Novas tentativas:** `maxRetries: 0` no Mastra; o script repete o turno inteiro, em sessão nova, até 3 tentativas, esperando o `Retry-After`. Um 429 cuja mensagem cita limite diário (`per day`, `TPD`, `RPD`) para a execução, e os turnos restantes entram como `EXEC_QUOTA`.

**Nova tentativa depois de tool executada:** as tools falsas não têm efeito, mas uma tentativa interrompida por 429 pode ter executado tools antes do erro. Cada tentativa interrompida fica em `previousAttempts` com o próprio registro (`businessToolCalls`, `toolLog`, `calls` e o erro). A pontuação usa só a última tentativa, então nenhuma chamada some nem conta duas vezes. O resumo lista, na seção "Tools repetidas por nova tentativa", os turnos em que uma tentativa anterior executou tools. Como o Mastra devolve o resultado sem `steps` quando o turno termina em erro, as chamadas vêm do `onStepFinish`, e toda entrada do `toolLog` sem chamada correspondente entra como chamada executada (reconciliação por nome e argumentos). Coberto em `run.test.ts`: tool concluída, 429, depois a tool de novo e o JSON final.

**Truncamento de contexto (método):** cada turno recebe um estado em `contextCheck.status`:

| Estado         | Quando                                                                                                                                                                                                           | Efeito                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `NOT_DETECTED` | Tokens informados em todas as chamadas, nenhum acima de 7680 e sem indício de corte                                                                                                                              | Passa                                                       |
| `DETECTED`     | Tokens de entrada informados acima de 7680 em alguma chamada (definição do CRITERIA.md)                                                                                                                          | `EXEC_CONTEXT_TRUNCATED`: o turno reprova todas as métricas |
| `UNKNOWN`      | Sem tokens informados em alguma chamada, turno não executado, ou indício de corte silencioso (tokens informados abaixo da metade de uma estimativa local: caracteres ÷ 4 do prompt, dos schemas e das mensagens) | Inconclusivo                                                |

No agregado, o requisito de truncamento (tolerância zero) passa só com os 18 turnos em `NOT_DETECTED`; um `DETECTED` reprova; qualquer `UNKNOWN` sem `DETECTED` deixa o requisito inconclusivo, e o modelo não é aprovado nos limites. Regra decidida pelo autor em 2026-11-11.

**Limites do método:** o Ollama corta a entrada que passa do contexto do servidor **sem erro** e informa os tokens já cortados, então o item 1 não vê esse corte; só o item 2 dá um indício. A estimativa por caracteres é imprecisa (o tokenizador muda por modelo, e JSON e português têm proporções diferentes). O Groq recusa entrada acima do contexto com erro, que vira `EXEC_PROVIDER_ERROR`. Os casos do spike ficam bem abaixo do orçamento, então a verificação serve mais para confirmar a folga do que para pegar cortes.

**Efeito externo:** durante cada turno, o `fetch` global é monitorado; qualquer requisição a host diferente do endpoint do modelo (`localhost:11434` ou `api.groq.com`) entra em `externalRequests` e vira `EXEC_EXTERNAL_EFFECT`. Não cobre clientes HTTP que não usem o `fetch` global.

**Raciocínio:** detectado por marcadores (`<think>`, canal `analysis` do formato do gpt-oss, `<reasoning>`) no texto final e na interpretação, e por chaves com "reason", "think" ou "thought" na interpretação; o conteúdo é removido antes de gravar. Raciocínio entregue em campo separado pelo provider só tem a presença registrada e não é vazamento. Raciocínio sem marcador no meio do texto não é detectado.

**Console e logs sem segredos:** o logger do Mastra imprime o objeto de erro inteiro (cabeçalhos, configuração, corpo), então o agent roda com `noopLogger`. Durante o turno, todo `console.*` passa por um filtro: textos sanitizados (o valor de `GROQ_API_KEY` lido do ambiente, `gsk_…`, `Bearer …` e `api_key…` viram `[redacted]`), erros viram "nome: mensagem (status)" e objetos viram "[objeto omitido]". Cada falha gera uma linha de diagnóstico: `[spike] C?, repetição n, tentativa k: CODE (HTTP s): mensagem`. Coberto em `run.test.ts` com uma chave fictícia sentinela no ambiente e no erro (mensagem, cabeçalhos, configuração, corpo): ela não aparece no console nem no registro, e o código, o status 401 e a mensagem útil aparecem.

**Fronteiras dos limites:** `score.test.ts` testa cada limite no valor exato e um abaixo: Zod 17/18 passa e 16/18 reprova; intenção, tool e entidades 15/18 passam e 14/18 reprovam; estabilidade com 4 entradas de 3 iguais e 2 de 2 iguais passa, e uma entrada com três resultados diferentes reprova.

**Maioria por entrada é implicada pela contagem:** com 6 entradas × 3 repetições, perder a maioria numa entrada exige pelo menos 2 erros nela. Ficar com maioria em menos de 5 entradas exige perdê-la em pelo menos 2, ou seja, pelo menos 4 erros, e então a contagem fica em no máximo 14/18, abaixo dos 15. Logo, quem atinge 15/18 sempre tem maioria em pelo menos 5 entradas. O `score.ts` calcula as duas condições mesmo assim, para o resumo mostrar onde estão os erros.

## Sondagem de capacidades (2026-11-11)

Duas chamadas por modelo, com entradas próprias (nenhuma entrada dos casos C1–C6), pelo mesmo caminho do Mastra:

- **Chamada A:** parâmetro de raciocínio + `seed: 42`, saída até 256 tokens.
- **Chamada B:** limite de saída de 16 tokens.

O `fetch` é envolvido para capturar o payload enviado (sem cabeçalhos e com as mensagens reduzidas à contagem) e, da resposta, `finish_reason`, `usage`, presença e tamanho do raciocínio (nunca o conteúdo) e o `Retry-After` em segundos (cabeçalhos `x-ratelimit-*` não são gravados). Resultados em `results/probes/<modelo>/<instante>.{json,md}`, separados dos resultados avaliativos.

```bash
OLLAMA_BASE_URL=http://localhost:11434/v1 node --env-file=.env src/probe.ts [--model "<rótulo>"]
OLLAMA_BASE_URL=http://localhost:11434/v1 node --env-file=.env src/probe.ts --control --model "ollama qwen3:8b"
```

O `--control` consulta o `/api/show`. Se o modelo não declara a capacidade `thinking`, não gera texto e registra `NOT_APPLICABLE`. Se declara, faz uma chamada igual à A, mas sem o parâmetro de raciocínio, e compara com a chamada A mais recente do modelo. Os resultados possíveis são `EFFECT_DEMONSTRATED`, `EFFECT_NOT_DEMONSTRATED`, `PARAM_INEFFECTIVE` e `UNKNOWN`. Grava em `<instante>-control.{json,md}`.

| Modelo                     | A: raciocínio                                                                                                                                                 | A: seed                | B: limite                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------- |
| `ollama qwen3:4b-instruct` | `reasoning_effort: "none"` transmitido, HTTP 200; nenhum raciocínio na resposta (9 tokens de saída)                                                           | `seed: 42` transmitido | `max_tokens: 16`, `finish_reason: length`, 16 tokens: limite aplicado |
| `ollama qwen3:8b`          | `reasoning_effort: "none"` transmitido, HTTP 200; nenhum raciocínio na resposta (5 tokens de saída)                                                           | `seed: 42` transmitido | `max_tokens: 16`, `length`, 16 tokens: limite aplicado                |
| `groq openai/gpt-oss-120b` | `reasoning_format: "hidden"` transmitido, HTTP 200; campo de raciocínio ausente, mas 46 `reasoning_tokens` informados: **`REASONING_HIDDEN`**, não desativado | `seed: 42` transmitido | `max_tokens: 16`, `length`, 16 tokens: limite aplicado                |

**O que isso comprova e o que não comprova:**

- Parâmetro transmitido e aceito não é capacidade comprovada.
- **`qwen3:8b`: efeito comprovado por chamada de controle.**
  - O `/api/show` lista as capacidades `completion`, `tools` e `thinking`.
  - Controle sem `reasoning_effort`: campo de raciocínio presente (327 caracteres, conteúdo descartado), 93 tokens de saída, `finish_reason: stop`.
  - Chamada A com `reasoning_effort: "none"`: campo ausente, 5 tokens de saída.
  - Fonte: `results/probes/ollama-qwen3-8b/2026-11-11T13-17-00-840Z-control.md`.
- **`qwen3:4b-instruct`: efeito não comprovado.**
  - O `/api/show` também lista `thinking` (com `tools` e `completion`), por isso houve chamada de controle em vez de `NOT_APPLICABLE`.
  - Controle sem o parâmetro: campo de raciocínio ausente, 9 tokens de saída, `stop`.
  - Chamada A com o parâmetro: o mesmo (9 tokens).
  - Neste caminho, o modelo não raciocina nem sem o parâmetro, então não há efeito a observar. O `reasoning_effort: "none"` continua aplicado, porque o `REASONING_CONTROL` vale para o provider inteiro e é aceito sem erro.
  - Fonte: `results/probes/ollama-qwen3-4b-instruct/2026-11-11T13-24-50-457Z-control.md`.
- No Groq, o modelo continua raciocinando (e gastando tokens da cota); o parâmetro só tira o raciocínio da resposta.
- `seed` transmitido não prova determinismo; a estabilidade é medida pelas 3 repetições.
- O `ollama ps` mostrou contexto 8192 nos dois modelos (o `/api/show` informa 40960 como máximo do `qwen3:8b`; vale o do servidor). O `qwen3:8b` roda dividido 37% CPU / 63% GPU.

**Configuração aplicada (`REASONING_CONTROL` no `run.ts`), só com o observado:** Ollama com `providerOptions.ollama.reasoningEffort = "none"`; Groq com `providerOptions.groq.reasoningFormat = "hidden"`. A nota gravada no cabeçalho de cada execução diz o que foi e o que não foi comprovado. O prompt continua igual para todos os modelos.

**Achado: `OLLAMA_BASE_URL` vazia.** A primeira sondagem do Ollama falhou com "Could not find config for provider ollama", porque o `.env` definia `OLLAMA_BASE_URL` sem valor (mecanismo explicado em "Conteúdo"). Para executar: preencher a variável no `.env`, removê-la ou passá-la na linha de comando, como acima. Trocar `??` por `||` no `models.ts` mudaria o manifesto e depende de decisão do autor.

## Política de `results/`

- **Versionável:** `results/` (os registros não guardam segredos).
- **Fora do versionamento:** `.env` (ignorado pela raiz), chaves, cabeçalhos de autorização, logs brutos (`*.log`), capturas cruas (`results/**/raw/`) e conteúdo de raciocínio (nunca gravado).
- **Organização:** sondagens em `results/probes/`; execuções avaliativas em `results/<modelo>/`.
- **Cabeçalhos de limite:** nenhum cabeçalho é gravado, nem nas sondagens nem nas execuções avaliativas. Os `x-ratelimit-*` (limit, remaining, reset) foram removidos em 2026-11-11 e não são mais capturados.
  - Do `Retry-After` fica só `retryAfterSeconds`, normalizado em segundos (forma numérica ou data HTTP).
  - Cada 429 de uma execução avaliativa entra em `rateLimits` com tentativa, instante, status HTTP, classificação (`EXEC_RATE_LIMIT`/`EXEC_QUOTA`), `daily`, `retryAfterSeconds` e `waitSeconds` (espera antes da próxima tentativa).
  - Os tokens de cada tentativa ficam em `calls` e em `previousAttempts`.
  - O resumo lista os 429 na seção "Respostas 429".

**Pendente para a Fase 2b:** a execução dos seis casos por modelo e as verificações ainda abertas da seção "Verificações da Fase 2" (E2 com saída estruturada + tools em cada modelo, `tool_choice` no Ollama, E1/E3/E4 do Groq).

### Regra de reexecução (definida antes da Fase 2b)

- Cada modelo roda UMA vez. A primeira execução completa é a oficial.
- Só se repete uma execução interrompida por falha de AMBIENTE (o
  processo caiu, a máquina hibernou, a rede caiu), nunca por resultado
  ruim. Erros do modelo, do provider ou de cota (EXEC\_\*) fazem parte do
  resultado e não autorizam repetir.
- Toda execução, inclusive a interrompida, fica em results/ e é citada
  no ADR, com o motivo da repetição.

## Verificação das datas

Em 2026-11-10, os 170 pacotes distintos do `package-lock.json` (diretos e transitivos, inclusive os aninhados) foram conferidos no registro: nenhum foi publicado depois de 2026-11-02T16:48Z (o corte de 7 dias na data da primeira resolução). O mais recente é `jose@6.2.15` (2026-11-01T22:28Z).
