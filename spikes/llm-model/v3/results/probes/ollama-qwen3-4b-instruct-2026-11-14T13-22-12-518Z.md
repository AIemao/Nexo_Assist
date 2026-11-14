# Sondagem V3 (Q1, Q2): ollama qwen3:4b-instruct

2026-11-14T13:22:12.518Z. Fora dos seis casos; diagnóstica, sem pontuação.

- Digest: 0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0
- Controle de raciocínio: reasoning_effort none (qwen3:8b: efeito comprovado por chamada de controle; qwen3:4b-instruct: efeito não comprovado, o controle sem o parâmetro também não raciocinou); providerOptions {"ollama":{"reasoningEffort":"none"}}
- Manifesto da V3: não congelado (SHA-256 do código no .jsonl)

## Q1 e Q2a (fase 2 isolada)

| Entrada | HTTP | Aceita | Sem tools / tool_choice | response_format | Mensagens tool | Erro | finishReason | JSON puro | Cerca | Prosa | Zod | `object` do Mastra | Tool calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Q1-1 | 200 | sim | sim | sim | 0 | — | stop | sim | não | não | sim | sim | — |
| Q1-2 | 200 | sim | sim | sim | 0 | — | stop | sim | não | não | sim | sim | — |
| Q1-3 | 200 | sim | sim | sim | 0 | — | stop | sim | não | não | sim | sim | — |
| Q2a-1 | 200 | sim | sim | sim | 1 | — | stop | sim | não | não | sim | sim | — |
| Q2a-2 | 200 | sim | sim | sim | 1 | — | stop | sim | não | não | sim | sim | — |

## Q2b (turno completo da V3)

| Entrada | Situação | Tools da fase 1 | Q2 exercitada | Fase 2 | Leitura | Zod | Invariantes | Falhas do instrumento | Truncamento | Latência (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Q2b-1 | completed | listMyTickets | sim | completed | OK | sim | OK | nenhuma | NOT_DETECTED | 8681 |
| Q2b-2 | completed | searchArticles | sim | completed | OK | sim | OK | nenhuma | NOT_DETECTED | 6035 |

Leitura: Q1 responde se o content vem como JSON puro com o response_format; Q2 responde se o Ollama aceita (HTTP 2xx) a forma da fase 2 com mensagens tool sem tools declaradas. Se a Q2 for negativa, o desenho é revisto antes de congelar (v3/CRITERIA.md).
