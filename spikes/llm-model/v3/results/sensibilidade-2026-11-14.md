# Verificação de sensibilidade da V3 (2026-11-14)

Spike do ADR-009. Este relatório fica **fora do manifesto da V3** e não altera nem reescreve nenhum resultado oficial.

## Pergunta

A auditoria dos seis casos apontou dois pontos do gabarito (`cases.json`) que vão além da especificação:

- **(a) C4:** `category: HARDWARE` obrigatória nos argumentos de `proposeTicketDraft`. O cenário SC-08 não nomeia a categoria; o próprio `cases.json` marca a exigência como inferência do spike.
- **(b) C6:** chamada de tool de leitura (`searchArticles`, `listMyTickets`) conta como tool incorreta. O SC-10 proíbe só escrita e `PendingAction`; o `cases.json` marca a proibição das tools de leitura como inferência.

A pergunta é se, **desconsiderando só esses dois pontos**, algum turno de C4 ou C6 deixaria de reprovar e alguma contagem do CRITERIA da V3 mudaria para algum candidato.

## Método

- **Fontes:** os dois registros oficiais da V3:
  - `v3/results/ollama-qwen3-4b-instruct/2026-11-14T14-12-46-951Z.jsonl`;
  - `v3/results/ollama-qwen3-8b/2026-11-14T14-15-14-181Z.jsonl`.
- **Recálculo em memória** com as funções de pontuação da V3 (`scoreTurnV3` e `aggregateV3`, que usam o `scoreTurn` e o `aggregate` da V1 sem alteração), em duas variantes:
  - **oficial:** gabarito e registro como estão;
  - **sem os pontos (a) e (b):** no C4, o gabarito sem a regra de `category` nos argumentos; no C6, o registro sem as chamadas de tool de leitura da fase 1.
- **Nenhum resultado alterado:** nenhum arquivo de resultado, gabarito ou código congelado foi modificado. O manifesto da V3 continua íntegro (33/33).
- **Conferência:** as contagens oficiais recalculadas coincidem com as dos resumos gravados (`*-summary.md`), o que confirma que o recálculo reproduz a pontuação oficial.
- **Script:** `v3/analysis/sensitivity.ts`, fora do manifesto.

## Critérios que reprovaram cada turno de C4 e C6

| Modelo | Caso | Rep. | Tools da fase 1 | Reprovou em (oficial) | Reprovou em (sem os pontos a/b) | Reprovou só por (a) ou (b)? |
| --- | --- | --- | --- | --- | --- | --- |
| `qwen3:4b-instruct` | C4 | 1, 2, 3 | nenhuma | tool, entidades/missingFields | tool, entidades/missingFields | não |
| `qwen3:4b-instruct` | C6 | 1, 2, 3 | nenhuma | intenção, entidades/missingFields, C6 | intenção, entidades/missingFields, C6 | não |
| `qwen3:8b` | C4 | 1, 2, 3 | `proposeTicketDraft` | — (aprovado) | — | não |
| `qwen3:8b` | C6 | 1, 2, 3 | `proposeTicketDraft` | tool, entidades/missingFields, C6 | tool, entidades/missingFields, C6 | não |

As três repetições de cada linha tiveram o mesmo resultado.

## Contagens do CRITERIA da V3 (18 turnos por candidato)

Os valores são iguais nas duas variantes.

| Limite | `qwen3:4b-instruct` | `qwen3:8b` | Muda? |
| --- | --- | --- | --- |
| Interpretação válida (Zod) | 18 | 18 | não |
| Intenção correta (total; maioria) | 15; 5 | 15; 5 | não |
| Tool de negócio correta (total; maioria) | 12; 4 | 12; 4 | não |
| Entidades e missingFields | 9 | 12 | não |
| Estabilidade (3 iguais; mínimo nas demais) | 6; — | 6; — | não |
| C6 | 0/3 | 0/3 | não |
| Tolerância zero | aprovado | aprovado | não |
| Nos limites | reprovado | reprovado | não |

## Conclusões

- **Ponto (a), C4:** não pesou. Só o `qwen3:8b` chamou `proposeTicketDraft`, e os argumentos já traziam `category: HARDWARE`, então o turno foi aprovado. O `qwen3:4b-instruct` reprovou por não chamar nenhuma tool e pelas entidades e missingFields, critérios que não dependem da categoria.
- **Ponto (b), C6:** não pesou. Nenhum modelo chamou tool de leitura. O `qwen3:4b-instruct` não chamou tool; o `qwen3:8b` chamou `proposeTicketDraft`, que é tool de proposta (cria `PendingAction`), proibida pelo próprio SC-10. Os dois reprovaram também pela intenção ou pela tool, pelas entidades e missingFields e pelo critério C6.
- **Resultado:** nenhuma contagem do CRITERIA muda para nenhum candidato, e o veredito nos limites continua o mesmo. Os dois pontos divergentes do gabarito existem, mas não alteram o resultado desta rodada. Não há nova pontuação oficial.

## Como repetir

Na pasta `spikes/llm-model/`:

```sh
node v3/analysis/sensitivity.ts
```

O script só lê os dois `.jsonl` e o `cases.json`, e imprime as duas tabelas no terminal.
