# Sondagem V2 (P1–P4): ollama qwen3:4b-instruct

2026-11-12T17:30:41.158Z. Fora dos seis casos; sem pontuação. Identificador: `ollama/qwen3:4b-instruct`.

- Digest: 0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0
- Contexto do servidor (/api/ps, depois das entradas): 8192 (conferido: 8192)
- Manifesto da V2: 28/28
- Controle de raciocínio: reasoning_effort none (qwen3:8b: efeito comprovado por chamada de controle; qwen3:4b-instruct: efeito não comprovado, o controle sem o parâmetro também não raciocinou); providerOptions {"ollama":{"reasoningEffort":"none"}}
- Pausa entre entradas: 0 ms
- Respostas com cabeçalho de limite de taxa: 0 de 6 (só presença; a pausa de 10 s do Mastra depende desse cabeçalho)

## Por entrada

| Entrada | Desfecho | P1 tool_choice | P1 HTTP 2xx | Turno concluído | HTTP | P3 provider (com id/sem id/duplicados) | Tentativas | Invariantes | Latência (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SONDA-1 | completed | auto | 2/2 | sim | 200, 200 | 1/0/0 | 1 | OK | 16440 |
| SONDA-2 | completed | auto | 1/1 | sim | 200 | 0/0/0 | 1 | OK | 513 |
| SONDA-3 | completed | auto | 3/3 | sim | 200, 200, 200 | 3/0/0 | 1 | OK | 3997 |

## Por tentativa (P2, P3 instrumento, P4)

| Entrada | Tentativa | Erro | P2 chamadas (passo:nome) | Submissão emitida / aceita | P3 instrumento (presentes/ausentes/duplicados) | P4 paralelas | Passos retry / não-retry | Limiar de passos atingido, com retry, sem submissão (observado) | Só texto |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SONDA-1 | 1 | — | 0:listMyTickets | não / não | 1/0/0 | nenhuma | 0 / 2 | não | sim |
| SONDA-2 | 1 | — | — | não / não | 0/0/0 | nenhuma | 0 / 1 | não | sim |
| SONDA-3 | 1 | — | 0:listMyTickets, 0:searchArticles, 1:searchArticles | não / não | 3/0/0 | passo 0 (2) | 0 / 3 | não | sim |

## Por passo (P4) e finishReason

- SONDA-1, tentativa 1: passo 0: 1 chamada(s) (negócio 1, submissão 0, outras 0), tool-calls; passo 1: 0 chamada(s) (negócio 0, submissão 0, outras 0), stop
- SONDA-2, tentativa 1: passo 0: 0 chamada(s) (negócio 0, submissão 0, outras 0), stop
- SONDA-3, tentativa 1: passo 0: 2 chamada(s) (negócio 2, submissão 0, outras 0), tool-calls; passo 1: 1 chamada(s) (negócio 1, submissão 0, outras 0), tool-calls; passo 2: 0 chamada(s) (negócio 0, submissão 0, outras 0), stop
