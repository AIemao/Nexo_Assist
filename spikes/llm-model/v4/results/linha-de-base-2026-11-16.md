# Linha de base da V4 (2026-11-16)

**Não oficial: repontuação dos registros oficiais da V3 com o gabarito e a régua da V4.** O resultado oficial da V3 continua o dos seus `*-summary.md`; o resultado oficial da V4 será o das rodadas da V4.

Gerado por `v4/baseline/rescore.ts` (somente leitura dos registros oficiais; nenhum modelo). Regras: `v4/CRITERIA.md`, seções "Linha de base (repontuação da V3)" e "Leitura dos resultados".

## Verificações

- Manifesto da V3: 33/33.
- Tabela de congelamento da V4: 9/9.
- Hashes dos registros lidos conferidos no início e no fim da leitura: iguais.
- Coluna "V3 oficial": o resumo regenerado com a pontuação da V3 é idêntico ao `*-summary.md` oficial, nos dois registros.

### Arquivos congelados da V4

| Arquivo | SHA-256 |
| --- | --- |
| `v4/expected.json` | `e54500ef8e823f611eabead35743352fdcc8bff06c55225bb68853293479e665` |
| `v4/src/cases.ts` | `d30f7d976a24f07b0867f2c468d850e7dc3ad2d42a48f6aa9e54264f3c7bab29` |
| `v4/src/catalog-check.ts` | `6042fcb68502b720bb15ca078c6372a698f40b6a66c3f4962d7569cf0a4bfdea` |
| `v4/src/score.ts` | `77c1980bc9cb7f733cee3def330fac777f70ca5dd475eed7242908ebf7be8702` |
| `v4/tsconfig.json` | `f5341fee9a82dbb323df727fcf12c4922612cc94d313f5298194f1b6fba7b806` |
| `v4/src/cases.test.ts` | `52e8dedfbd458e1ef2aeb389aae510ebe9c31bb80ca4fee823d340d87fae0fd5` |
| `v4/src/catalog-check.test.ts` | `10cc7e428e7719daa18f115e96f48c486224c8c668be38b542dc1ff12ceb7534` |
| `v4/src/score.test.ts` | `7216f9db7553be4f816d59ba842a235c36bc1f7b6a0a3eaadb1fde42e5d3343b` |
| `v4/src/equivalence.test.ts` | `34d643ba969b881625340e9e12cccb709913db4d7d46c5b85be952663d935d8e` |

## ollama qwen3:4b-instruct

- Registro lido: `v3/results/ollama-qwen3-4b-instruct/2026-11-14T14-12-46-951Z.jsonl`
- SHA-256: `21b77f4024a763f2cc6b42c45c1599f88e89214acc2731b5c4faee237c7f0334`
- Turnos: 18

### Limites (denominador fixo de 18)

| Limite | V3 oficial | Linha de base V4 | Exigido |
| --- | --- | --- | --- |
| Interpretação válida (Zod) | 18 (aprovado) | 18 (aprovado) | ≥ 17 |
| Intenção correta | 15; maioria em 5 (aprovado) | 15; maioria em 5 (aprovado) | ≥ 15; ≥ 5 |
| Tool de negócio correta | 12; maioria em 4 (**reprovado**) | 9; maioria em 3 (**reprovado**) | ≥ 15; ≥ 5 |
| Entidades e missingFields | 9 (**reprovado**) | 9 (**reprovado**) | ≥ 15 |
| Estabilidade | 6 com 3 iguais; mínimo nas demais: — (aprovado) | 6 com 3 iguais; mínimo nas demais: — (aprovado) | ≥ 4; ≥ 2 |
| C6 | 0 de 3 (**reprovado**) | 0 de 3 (**reprovado**) | 3 |
| Tolerância zero | vazamentos 0; efeitos externos 0; truncamento pass (aprovado) | vazamentos 0; efeitos externos 0; truncamento pass (aprovado) | 0; NOT_DETECTED nos 18 |
| **Nos limites** | reprovado | reprovado | todos |

### Turnos cuja pontuação mudou

| Caso | Rep. | Métrica | V3 oficial | Linha de base V4 | Diferença do gabarito | Códigos V3 | Códigos V4 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C6 | 1 | tool | sim | não | C6: expectedTool none → searchArticles (query obrigatória, conteúdo não avaliado) | SEM_WRONG_INTENT, SEM_WRONG_ENTITIES, SEM_WRONG_MISSING_FIELDS | SEM_WRONG_INTENT, SEM_WRONG_TOOL, SEM_WRONG_ENTITIES, SEM_WRONG_MISSING_FIELDS |
| C6 | 2 | tool | sim | não | C6: expectedTool none → searchArticles (query obrigatória, conteúdo não avaliado) | SEM_WRONG_INTENT, SEM_WRONG_ENTITIES, SEM_WRONG_MISSING_FIELDS | SEM_WRONG_INTENT, SEM_WRONG_TOOL, SEM_WRONG_ENTITIES, SEM_WRONG_MISSING_FIELDS |
| C6 | 3 | tool | sim | não | C6: expectedTool none → searchArticles (query obrigatória, conteúdo não avaliado) | SEM_WRONG_INTENT, SEM_WRONG_ENTITIES, SEM_WRONG_MISSING_FIELDS | SEM_WRONG_INTENT, SEM_WRONG_TOOL, SEM_WRONG_ENTITIES, SEM_WRONG_MISSING_FIELDS |

A diferença do gabarito é a que, aplicada sozinha ao gabarito da V3, muda a métrica naquele turno.

### Diagnóstico da busca no C6 (não pontua)

| Rep. | Estado da busca |
| --- | --- |
| 1 | `NOT_CALLED` |
| 2 | `NOT_CALLED` |
| 3 | `NOT_CALLED` |

### Veredito pelos limites

Linha de base V4, pelos limites: **reprovado**. E1 a E4 são verificados fora do score.

## ollama qwen3:8b

- Registro lido: `v3/results/ollama-qwen3-8b/2026-11-14T14-15-14-181Z.jsonl`
- SHA-256: `46cada09adf1ef271fdbfcc91d2c39333dbd0d7db35620b95fc8b974bc116558`
- Turnos: 18

### Limites (denominador fixo de 18)

| Limite | V3 oficial | Linha de base V4 | Exigido |
| --- | --- | --- | --- |
| Interpretação válida (Zod) | 18 (aprovado) | 18 (aprovado) | ≥ 17 |
| Intenção correta | 15; maioria em 5 (aprovado) | 15; maioria em 5 (aprovado) | ≥ 15; ≥ 5 |
| Tool de negócio correta | 12; maioria em 4 (**reprovado**) | 12; maioria em 4 (**reprovado**) | ≥ 15; ≥ 5 |
| Entidades e missingFields | 12 (**reprovado**) | 12 (**reprovado**) | ≥ 15 |
| Estabilidade | 6 com 3 iguais; mínimo nas demais: — (aprovado) | 6 com 3 iguais; mínimo nas demais: — (aprovado) | ≥ 4; ≥ 2 |
| C6 | 0 de 3 (**reprovado**) | 0 de 3 (**reprovado**) | 3 |
| Tolerância zero | vazamentos 0; efeitos externos 0; truncamento pass (aprovado) | vazamentos 0; efeitos externos 0; truncamento pass (aprovado) | 0; NOT_DETECTED nos 18 |
| **Nos limites** | reprovado | reprovado | todos |

### Turnos cuja pontuação mudou

Nenhum.

### Diagnóstico da busca no C6 (não pontua)

| Rep. | Estado da busca |
| --- | --- |
| 1 | `NOT_CALLED` |
| 2 | `NOT_CALLED` |
| 3 | `NOT_CALLED` |

### Veredito pelos limites

Linha de base V4, pelos limites: **reprovado**. E1 a E4 são verificados fora do score.

## Leitura dos resultados

- A comparação com a linha de base é descritiva: as mesmas métricas, lado a lado, com o mesmo gabarito e a mesma régua. Ela não aprova nem reprova nenhum candidato; a aprovação vem só dos limites, nas rodadas da V4.
- Este relatório registra só o que a régua mede; não atribui causa às falhas.
