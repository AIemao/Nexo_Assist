# ADR-006 — Ciclos de estado independentes: conversa, interação, autorização, execução

- **Status:** Aceito
- **Data:** 2026-11-02
- **Bloco:** 1

Como representar o estado do atendimento: um status único ou ciclos separados?

## Contexto

Durante um atendimento acontecem coisas diferentes, cada uma com seu ritmo: quem controla a conversa, o que se espera do funcionário, se ele autorizou uma ação e o que aconteceu com a operação no ticket-service. Elas se sobrepõem. Um handoff pode ocorrer com um rascunho aberto, ou durante uma execução não terminal (DM §8.6).

## Decisão

Quatro ciclos **independentes** (README §7, DM §8):

- **Conversa:** quem controla o atendimento.
- **Interação:** o que se espera do funcionário (`InteractionContext`; transições no Agent Flow).
- **Autorização:** `PendingAction`.
- **Execução:** `OperationExecution`.

Independência não é ausência de coordenação. Cada ciclo tem responsabilidade, estados e momento de conclusão próprios, e as regras entre eles ficam em DM §8.6. O Agent Flow complementa o comportamento de `InteractionContext` sem redefinir os demais ciclos.

## Alternativas consideradas

### A. Um único campo de status na conversa

Estados como `AGUARDANDO_CONFIRMACAO`, `EXECUTANDO` e `COM_ANALISTA`. É a alternativa concorrente mais forte: parece mais simples de implementar e há um estado central fácil de exibir na UI. Foi rejeitada porque:

- Mistura ciclos com responsáveis e tempos de vida diferentes.
- As combinações crescem. Exemplos: handoff durante uma execução não terminal; transferência com rascunho aberto.
- Um status único não representa a situação simultânea de conversa, autorização pendente e execução técnica.
- Cada novo comportamento exigiria estados compostos e transições especiais.

### B. Inferir o estado da memória do LLM ou do histórico de mensagens

Teria menos estruturas explícitas e uma experiência mais conversacional. Foi rejeitada porque:

- A memória do LLM não é fonte de verdade.
- Inferir estado a partir de mensagens é ambíguo e não permite controle determinístico das invariantes.
- O estado de negócio precisa ser recuperável sem depender de interpretação do modelo.

O histórico persistido continua essencial como registro de eventos e de contexto. A rejeição é à **inferência do estado** pelo modelo ou pela leitura das mensagens, e não à persistência do histórico.

## Consequências

**Positivas**

- Responsabilidades claras e estado recuperável.
- Auditoria por ciclo e testes específicos para cada um.

**Negativas e custos**

- Mais entidades, transições e regras de coordenação.
- Mais cuidado com concorrência e consistência entre os ciclos.

## E se o produto crescer para 20 mil funcionários?

**Permanece:** a separação dos quatro ciclos.

**Pode evoluir** (hipóteses futuras, não aprovadas nem implementadas): o controle de concorrência e a coordenação assíncrona entre ciclos, possivelmente com mecanismos como outbox e processamento por eventos. Isso não exige fundir os ciclos.

## Rastreabilidade

- README §7 (quatro ciclos e regras centrais) e §9 (concorrência).
- Domain Model v2.2: §8 (ciclos), em especial §8.6 (concorrência entre ciclos).
- Agent Flow v1.2: D1 (o backend altera o `InteractionContext`), D3 (confirmação e rejeição pertencem ao ciclo da `PendingAction`) e D12 (contexto congelado fora de `AI_ACTIVE`).
