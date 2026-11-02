# ADR-002 — Arquitetura enxuta: duas aplicações executáveis

- **Status:** Aceito
- **Data:** 2026-11-02
- **Bloco:** 1

Quantos processos executáveis o sistema precisa, e onde passa a fronteira entre eles?

## Contexto

O sistema tem duas áreas de responsabilidade. Uma é a experiência de atendimento: UI, BFF, agent e conhecimento. A outra é o domínio dos chamados: prioridade, SLA, duplicidade, reabertura e idempotência. O ticket-service representa um sistema legado e, no escopo, tem falha simulada (README §3). O README registra que só o ticket-service precisa ser um processo separado, porque o PRD exige (README §5, Princípios).

## Decisão

Duas aplicações executáveis (README §5):

- **`apps/web`** (Next.js): UI, BFF, agent Mastra no servidor e módulo de conhecimento.
- **`apps/ticket-service`** (Node.js): dono do domínio e das regras dos chamados.

A separação marca uma fronteira real de responsabilidade e integração. As regras de chamado ficam na camada de domínio do ticket-service e não são copiadas no web. Pacotes compartilhados só surgem com necessidade concreta (README §5).

## Alternativas consideradas

### A. Monólito modular

- O PRD exige o ticket-service como aplicação separada (README §5, Princípios); os motivos abaixo explicam por que a exigência faz sentido arquitetural.

O domínio de chamados seria um módulo interno do `web`, e a falha do legado seria simulada em código. É a alternativa concorrente mais forte: menos processos, chamadas internas mais rápidas e desenvolvimento local mais simples. Foi rejeitada porque:

- Apaga a fronteira de propriedade do domínio de chamados.
- Não exercita a comunicação pela rede.
- Timeout, idempotência, falha de comunicação e reconciliação (README §9) perdem sentido contra um módulo local. Só têm sentido contra um serviço separado.
- Enfraquece o valor demonstrativo de integrar com um sistema legado.

### B. Microsserviços

Agent, conhecimento e conversas seriam serviços independentes. Responsabilidades distintas não exigem processos distintos. O custo operacional de vários serviços não se justifica sem necessidade de escala independente, e essa necessidade não está registrada nas fontes (README §3, "Fora").

## Consequências

**Positivas**

- Fronteira clara e integração real por API.
- É possível simular falhas do legado e exercitar retry e reconciliação.
- O ticket-service evolui de forma independente.

**Negativas e custos**

- Dois processos e comunicação HTTP.
- Tratamento de falhas entre serviços, inclusive sem atomicidade entre eles (README §9).

## E se o produto crescer para 20 mil funcionários?

**Permanece:** a separação em duas aplicações e o ticket-service como fronteira de integração com o sistema legado. O agent não ganha acesso direto a ele.

**Pode evoluir:** o processamento do agent, com workers e filas. Isso é uma hipótese futura, não aprovada nem implementada. Microsserviços adicionais não são consequência obrigatória da escala.

## Rastreabilidade

- README §3 ("Fora", "Dentro") e §5 (visão geral, princípios).
- README §9 (falhas e reconciliação).
