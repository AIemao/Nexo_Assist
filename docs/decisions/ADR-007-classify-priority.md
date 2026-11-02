# ADR-007 — classifyPriority total no domínio do ticket-service

- **Status:** Aceito
- **Data:** 2026-11-02
- **Bloco:** 1

Quem decide a prioridade de um chamado, e o que acontece quando faltam dados?

## Contexto

A prioridade determina o prazo e o tratamento do chamado. O funcionário pode descrever a urgência de formas muito diferentes, e dados importantes podem faltar. A regra precisa ser reproduzível e testável, e não pode depender do que o modelo decide (DM §7.1, invariante 3).

## Decisão

`classifyPriority` é uma função **total e determinística** na camada de domínio do ticket-service (DM §4):

- **Precedência explícita:** a primeira regra que casa vence.
- **Resultado discriminado:** devolve uma classificação ou `NEEDS_CLARIFICATION` quando faltam dados. `NEEDS_CLARIFICATION` não é uma prioridade (invariante 4).
- **Caso `BLOCKED` com alcance `UNKNOWN`:** a prioridade é `HIGH`, como piso conservador. Não vira `CRITICAL` automaticamente, não gera handoff e a pergunta não se repete.
- **Dono único:** o ticket-service é dono da regra. O web obtém o resultado por leitura e não mantém cópia. A classificação e o prazo são revalidados na confirmação (README §6).

**Sobre "total":** a função tem resultado definido para toda entrada de seu domínio, inclusive entrada incompleta. Não significa atribuir prioridade quando faltam dados. O piso `HIGH` se aplica somente à combinação acima, e não a todo alcance desconhecido.

## Alternativas consideradas

### A. O LLM classifica a prioridade

É a alternativa concorrente mais forte. Tem flexibilidade para interpretar linguagem natural e nuances que os campos estruturados não capturam. Foi rejeitada porque:
- Os resultados não são suficientemente reprodutíveis.
- Não permite uma tabela de testes determinísticos que cubra combinações e precedências.
- Pode ser influenciada pela forma como o funcionário descreve a urgência ("é urgente!") ou por instruções manipuladoras.

O LLM pode ajudar a interpretar os dados, mas não é a autoridade que define a prioridade.

### B. Calcular a prioridade no web

Seria mais simples com um único consumidor inicial. Duplica a regra fora do serviço dono do domínio, pode divergir dela e tira do ticket-service a autoridade única na revalidação (README §5).

### C. Função parcial com `MEDIUM` por padrão quando faltam dados

Evita interromper a conversa com perguntas. Atribui prioridade em silêncio sem informação suficiente e mascara lacunas relevantes. Para `BLOCKED` com alcance `UNKNOWN`, `CRITICAL` superestimaria o caso e insistir na pergunta prejudicaria o atendimento. O piso `HIGH` foi a resposta para esse caso.

## Consequências

**Positivas**
- Reprodutibilidade e testes de tabela com todas as combinações (README §10).
- Autoridade única no ticket-service, com revalidação na confirmação.

**Negativas e custos**
- Manutenção explícita das regras de precedência.
- Necessidade de coletar dados estruturados antes de classificar certos casos.

## E se o produto crescer para 20 mil funcionários?

**Permanece:** a função total e determinística, no ticket-service.

**Pode evoluir** (hipóteses futuras, não aprovadas nem implementadas): regras configuráveis por área ou unidade, versionamento da tabela de regras e rastreabilidade de qual versão e quais regras foram aplicadas (`appliedRules`). Qualquer configuração futura deve preservar resultado determinístico para a mesma entrada e a mesma versão de regras.

## Rastreabilidade

- README §6 (classificação e prazo vêm do ticket-service) e §10 (testes de tabela).
- Domain Model v2.2: §4 (`classifyPriority`, regra 4) e §7.1 (invariantes 3 e 4).
