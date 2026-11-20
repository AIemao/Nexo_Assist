# ADR-009 — Escolha do modelo LLM

- **Status:** Aceito, com condições de adoção
- **Data:** 2026-11-20
- **Bloco:** 4

Qual modelo LLM o Nexo Assist usa, com custo zero, e de que forma ele precisa ser integrado para cumprir o contrato de interpretação e de tools?

## Contexto

O README §11 reserva este ADR para a escolha do modelo, e o README §12 #9 registrava a decisão inicial: "rápido e barato; regras no código reduzem a exigência". A tese do projeto define o papel do modelo: **o LLM interpreta e propõe; o código decide e executa** (README §1; ADR-001). Em cada turno, o modelo produz a interpretação estruturada (DM §3.12: `intent`, `confidence`, `entities`, `missingFields`) e pode chamar tools de leitura e de proposta. O backend valida, decide e executa.

O projeto é de estudo. A escolha passou por quatro critérios eliminatórios, aprovados antes da pesquisa:

| ID  | Critério                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------ |
| E1  | Custo zero na API, sem cartão de crédito e sem créditos promocionais temporários                                   |
| E2  | Compatível com o Mastra na versão adotada e com o contrato funcional: chamada de tools e interpretação estruturada |
| E3  | Termos aceitáveis para dados **fictícios**. Dados reais não passam por essa configuração                           |
| E4  | Cota gratuita suficiente para uma avaliação completa por dia, com as repetições do protocolo                       |

A lista inicial de candidatos era Gemini, GitHub Models, Groq, OpenRouter e Ollama. O repositório registra a triagem de dois: o Ollama local atende ao E1 e ao E4 (sem custo nem cota) e ao E3 (os dados ficam na máquina), e o E2 foi verificado em execução no spike; o Groq não atende ao E4 e ficou só como referência (fonte: `spikes/llm-model/CRITERIA.md`, na tag `spike-adr-009`). A triagem dos outros três não ficou registrada no repositório.

Os candidatos foram comparados num spike (`spikes/llm-model/`, branch `spike/modelo-llm`) em quatro versões, cada uma com a régua congelada antes de rodar e uma única variável alterada em relação à anterior.

## Decisão

**1. Modelo: `qwen3:8b`, servido localmente pelo Ollama.** Atende E1 a E4: roda no hardware existente, sem custo nem cota, e as chamadas de inferência são processadas localmente, sem envio dos dados da conversa a um provider externo.

**2. Integração D1: a interpretação é gerada numa chamada separada, disparada pelo código.**

- Fase 1: um agente com as tools de negócio conduz o turno.
- Fase 2: um segundo agente, **sem tools**, recebe a transcrição filtrada da fase 1 (chamadas e resultados das tools, sem o texto final nem o raciocínio) e devolve a interpretação por saída estruturada.
- O código valida o **texto bruto** com `JSON.parse` e o schema Zod estrito. O objeto que o framework devolve já corrigido não é usado como resultado.

**3. O modelo foi escolhido sem atingir a régua do spike.** Nenhum candidato atingiu integralmente os limites de aprovação, em nenhuma versão. O `qwen3:8b` não foi aprovado pelo spike. Ele foi escolhido por apresentar o comportamento mais compatível com os princípios do Nexo Assist, e a escolha vale **só com as condições de adoção abaixo**.

### Condições de adoção

São contratos do Bloco 4. O Bloco 4 precisa implementá-las e validá-las antes de considerar confiável o fluxo de criação de chamados. O aceite do modelo **não** autoriza confiar nas interpretações do LLM.

1. **A completude é calculada pelo código.** O `missingFields` do modelo é uma sugestão, nunca a autoridade sobre a completude do rascunho. O backend calcula os campos que faltam a partir dos dados efetivamente coletados e validados (AF D3, §8.1). Um campo preenchido e validado não volta a ser tratado como ausente porque o modelo o listou, e o modelo não declara o rascunho completo omitindo um campo obrigatório. Isto se liga à pendência AF P-H (onde ficam título, descrição e tipo antes da proposta) e à tensão X1 dos cenários (onde nasce a pergunta do alcance), que passam a ser trabalho de desenho do Bloco 4.
2. **A interpretação passa por uma checagem de coerência e integridade no código.** JSON válido não significa interpretação válida. O código verifica, no mínimo: contradições entre `entities` e `missingFields`; valores sem sustentação na conversa (como uma categoria preenchida para um relato que não diz o que parou); e conteúdo corrompido (como um campo de texto que contém fragmentos de JSON). Uma interpretação que não passa nas checagens não faz a operação avançar como se estivesse correta. Os valores aceitos precisam ter origem identificável e sustentação compatível com as regras do domínio. Quando o backend não puder comprovar essa sustentação por um mecanismo definido, o valor não é usado e o fluxo pede esclarecimento, sem tentar reconstruí-lo por inferência.
3. **O impacto nunca é preenchido pelo código a partir da prosa do modelo.** `affectedScope`, `workImpact` e `commitmentRisk` só são usados como valores estruturados de origem compatível com a AF D26. Ausente ou sem sustentação, o fluxo pergunta ao funcionário. Uma omissão vira pergunta, nunca reconstrução automática do valor.
4. **As instruções da V4 são a linha de base.** O prompt, as descrições das tools e os `.describe` da V4 (`PROMPT_VERSION` `spike-adr009-prompt-v4`) são a versão de referência para a avaliação do Bloco 8. Qualquer alteração ganha uma nova versão, sem substituir a referência.
5. **Latência registrada como limitação.** Mediana de cerca de 43 s por turno nesta máquina (GTX 1660 Super, 6 GB, com parte do modelo na CPU). O critério de custo zero é do estudo. Com outro hardware ou outro provider, a escolha é reavaliada com o mesmo instrumento e a mesma régua.

**Atualização (2026-11-20).** Nota posterior à decisão; as condições acima não mudam e nenhuma é retirada. O plano do Bloco 4 distribui a implementação entre dois blocos. No Bloco 4, a condição 2 é implementada e validada, porque vale para todo turno com o modelo, inclusive os cenários executáveis no Bloco 4; as condições 1 e 3 ficam com o contrato definido. No Bloco 5, as condições 1 e 3 são implementadas e validadas junto com a coleta e a completude do rascunho, porque atuam sobre a coleta, que nenhum cenário do Bloco 4 exercita. O fluxo completo de criação de chamados só pode ser considerado confiável depois que as condições 1 e 3 estiverem implementadas e validadas no Bloco 5.

## Alternativas consideradas

### A. `qwen3:4b-instruct` (Ollama local)

Cabe inteiro na placa e é mais rápido (mediana de 13 s por turno na V4). Descartado: com as instruções da V4, a interpretação da fase 2 degenerou em 6 de 18 turnos. O primeiro campo de texto livre virou prosa repetida até o limite de 512 tokens, e o JSON não fechou. Também regrediu em casos que antes acertava.

### B. Groq `openai/gpt-oss-120b`

Referência de modelo grande. Descartado: não atende ao E4 com os limites lidos em 2026-11-09 (30 RPM, 1.000 RPD, 8.000 TPM, 200.000 TPD, contra cerca de 1,5 milhão de tokens de entrada por avaliação completa). A validação estrita do provider também recusa o schema atual (HTTP 400: exige todas as propriedades de `entities`).

### C. Saída estruturada e tools na mesma chamada (V1)

Com a saída estruturada ativa, o Ollama não fez nenhuma chamada de tool. No caminho do Groq, o framework forçou uma tool sintética de JSON. Rejeitada: o contrato exige as duas coisas no mesmo turno.

### D. Tool terminal de protocolo (`submitInterpretation`, V2/V2.1)

A seleção de tools melhorou, mas a interpretação válida caiu (6 e 9 de 18). Rejeitada: o modelo pequeno não sustenta o protocolo e a interpretação ao mesmo tempo.

### E. Continuar o spike (V5) ajustando o prompt

Rejeitada. Os seis casos são o único conjunto de avaliação. Ajustar as instruções contra as falhas observadas neles seria usar o conjunto de avaliação também como conjunto de desenvolvimento: uma melhora mostraria adaptação a esses seis exemplos, não generalização. Uma V5 honesta exigiria um novo conjunto de casos independentes, com critérios próprios, o que não se justifica agora. Além disso, as falhas restantes do `qwen3:8b` podem ser contidas pelo desenho determinístico do backend, embora não sejam todas responsabilidades originalmente atribuídas ao código. O modelo continua responsável pela extração semântica e pela interpretação estruturada. O backend assume a completude, a checagem de coerência e a decisão segura diante de dados ausentes ou sem sustentação: rejeita ou pergunta, mas não inventa nem reconstrói valores a partir de prosa.

## Evidências do spike

Configuração comum: Node 26.13.0, `@mastra/core` 1.81.0, Zod 4.6.7, Ollama 0.40.16 com `OLLAMA_CONTEXT_LENGTH=8192`. Temperatura 0, seed 42, até 512 tokens de saída, 180 s por turno, até 3 tentativas. Seis casos (C1–C6, derivados dos cenários SC-01, SC-02, SC-04, SC-08, SC-13 e SC-10), três repetições cada: denominador fixo de 18.

| Modelo              | Imagem                                                                    | Uso da placa      |
| ------------------- | ------------------------------------------------------------------------- | ----------------- |
| `qwen3:4b-instruct` | digest `0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0` | 100% GPU          |
| `qwen3:8b`          | digest `500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41` | 37% CPU / 63% GPU |

**Como ler as tabelas.**

- Nas linhas de intenção e tool, o primeiro número é o de acertos nos 18 turnos; o segundo, o de casos (entre os 6) em que a maioria das 3 repetições acertou.
- Na linha do C6, o número é o de repetições aprovadas, entre 3.
- A tolerância zero cobre vazamento de raciocínio, truncamento detectado e efeitos externos. "Aprovado" ali não significa ausência de falhas semânticas. Nenhuma rodada desta tabela teve violação de invariante.
- A "V3 repontuada" é uma linha de base comparativa **não oficial**: os registros oficiais da V3, pontuados com a régua da V4. Ela não substitui os resultados congelados da V3.

**Resultados do `qwen3:8b`** (limites iguais em todas as versões; V4 com o gabarito corrigido pelas D25–D27):

| Limite (exigido)                     | V1       | V2.1        | V3       | V3 repontuada (linha de base) | **V4**       |
| ------------------------------------ | -------- | ----------- | -------- | ----------------------------- | ------------ |
| Interpretação válida, Zod (≥ 17)     | 18       | 9           | 18       | 18                            | **18**       |
| Intenção correta (≥ 15; maioria ≥ 5) | 15; 5    | 3; 1        | 15; 5    | 15; 5                         | **18; 6**    |
| Tool correta (≥ 15; maioria ≥ 5)     | 3; 1     | 12; 4       | 12; 4    | 12; 4                         | **18; 6**    |
| Entidades e `missingFields` (≥ 15)   | 9        | 0           | 12       | 12                            | **12**       |
| Estabilidade (≥ 4 com 3 iguais)      | 6        | 3           | 6        | 6                             | **6**        |
| "Parou tudo!", C6 (3 de 3)           | 0        | 0           | 0        | 0                             | **0**        |
| Tolerância zero                      | aprovado | aprovado    | aprovado | aprovado                      | **aprovado** |

Fonte da coluna V1: `spikes/llm-model/results/`, nos resumos da V1.

**Resultados do `qwen3:4b-instruct`:**

| Limite (exigido)                   | V1   | V2.1        | V3    | V3 repontuada | **V4**    |
| ---------------------------------- | ---- | ----------- | ----- | ------------- | --------- |
| Zod (≥ 17)                         | 12   | 6           | 18    | 18            | **12**    |
| Intenção (≥ 15; ≥ 5)               | 6; 2 | 3; 1        | 15; 5 | 15; 5         | **6; 2**  |
| Tool (≥ 15; ≥ 5)                   | 3; 1 | 18; 6       | 12; 4 | 9; 3          | **15; 5** |
| Entidades e `missingFields` (≥ 15) | 3    | 3           | 9     | 9             | **3**     |
| Estabilidade (≥ 4)                 | 4    | 2           | 6     | 6             | **4**     |
| C6 (3 de 3)                        | 0    | 0           | 0     | 0             | **0**     |

**O que mudou entre a V3 e a V4 no `qwen3:8b`** (diagnóstico da V4):

| Caso                   | V3                                                                      | V4                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| C6 ("Parou tudo!")     | **inventou** alcance (`COMPANY`) e risco (`YES`) e **propôs** o chamado | buscou na central, **não propôs**, não inventou o alcance; **omitiu** o `BLOCKED` e preencheu `category: OTHER` sem sustentação |
| C4 (pedido de monitor) | correto                                                                 | rascunho correto nos 7 argumentos; o `missingFields` lista campos que o próprio modelo preencheu                                |
| C1 (dúvida)            | respondeu sem buscar e inventou o horário                               | buscou na central                                                                                                               |

Quase todas as falhas restantes passaram de inventar para omitir ou perguntar demais. A exceção é a categoria sem sustentação no C6, coberta pela condição 2.

**Robustez da régua.** A auditoria dos casos contra a especificação (somente leitura, sem usar respostas dos modelos como fonte) encontrou pontos em que o prompt não ensinava regras que a especificação definia, e três ambiguidades na própria especificação. Elas foram resolvidas como decisões de produto (AF D25, D26 e D27). A verificação de sensibilidade e a linha de base mostraram que corrigir a régua não muda nenhum veredito da V3. A régua da V4 foi validada por um teste de equivalência: com o gabarito da V3, ela reproduz byte a byte os resumos oficiais da V3.

**Proteção contra vazamento do gabarito.** As instruções da V4 não têm exemplos. Um teste automático confere que nenhum texto lido pelo modelo contém frases dos casos, termos que os identificam ou trechos das fixtures. Uma revisão humana do autor, com lista de verificação, cobriu as paráfrases.

**Comportamentos do framework medidos (Mastra 1.81.0):**

- `toolChoice: "none"` não impede a execução de tools.
- O `object` devolvido corrige o JSON (cercas de código, prosa ao redor, reparo de texto truncado). Por isso a validação usa o texto bruto.
- Com o cabeçalho de limite de tokens baixo, o framework pausa 10 s e adia os avisos de fim de passo.
- No estouro de tempo, o resultado sai com `finishReason: "aborted"`, sem exceção.
- No caminho do Agent, a entrada da tool é validada uma vez, pelo `CoreToolBuilder`, que marca o contexto. O envoltório da `Tool` consome a marca e não valida de novo. Em chamada direta, quem valida é o envoltório.

## Consequências

**Positivas**

- O padrão de integração não depende do modelo e foi medido com dois modelos.
- Custo zero, com a inferência processada localmente, sem envio dos dados da conversa a um provider externo.
- O instrumento do spike (manifestos, invariantes, régua congelada, equivalência, detector de vazamento) é reaproveitável na avaliação do Bloco 8.
- As decisões D25–D27 deixaram a especificação mais precisa, independentemente do modelo.

**Negativas e custos**

- Duas chamadas ao modelo por turno, com cerca de 800 tokens de instrução em cada uma: mediana de 43 s por turno nesta máquina.
- A confiabilidade do fluxo depende das condições de adoção, que ainda precisam ser implementadas.
- Nenhum candidato atingiu a régua. A escolha é uma decisão de engenharia, não um aprovado do spike.

**Achados para o Bloco 4, além das condições de adoção** (cada um precisa de decisão própria):

1. **A busca na central pode precisar ser garantida pelo código.** O `qwen3:8b` buscou em todos os casos da V4, mas não buscava no C1 da V3. A AF D25 deixa em aberto quem garante a busca.
2. **O schema do DM §3.12 precisa ser compatível com provider estrito** (propriedades obrigatórias que aceitam `null`), para não excluir providers como o Groq numa reavaliação.
3. **O estouro de tempo precisa ser detectado** (`aborted` sem exceção). O instrumento da V3 e da V4 detecta; o produto precisa detectar.

## E se o produto crescer para 20 mil funcionários?

O custo zero (E1) é uma restrição do estudo, não do produto. A configuração testada (um modelo local na máquina do desenvolvedor) não foi dimensionada nem validada para esse cenário: o spike não mediu capacidade de produção. Dados reais também exigem um provider com termos de tratamento aceitos (E3).

**Permanece:** a integração D1, as condições de adoção e a tese de que o código decide e executa. Nada disso depende do modelo.

**Pode evoluir** (hipótese, não decidida aqui): um provider pago com acordo de tratamento de dados, escolhido com o mesmo instrumento e a mesma régua funcional do spike, sobre um conjunto de casos ampliado. Essa mudança exigiria uma decisão separada sobre os critérios de elegibilidade, especialmente o E1, preservando os resultados deste spike como referência de comparação.

## Rastreabilidade

- README §1 (tese), §6 (três camadas), §11 (ADR-009), §12 #9 (modelo) e #10 (baixa confiança, que depende do modelo).
- Domain Model v2.14: §3.12, §3.15, §4, §7.1 (invariantes 3 e 5).
- Agent Flow v1.6: D3, D25, D26, D27; §8.1; P-G e P-H.
- Cenários de avaliação v1.8: §6 (baseline do Bloco 8) e tensão X1.
- ADR-001 (estratégia híbrida).

**Cadeia de evidências.** Branch `spike/modelo-llm`, preservada pela tag `spike-adr-009`.

| Commit                          | O que registra                                                            |
| ------------------------------- | ------------------------------------------------------------------------- |
| `29ef656`, `f709f2c`, `2182d6b` | V1: experimento, instrumento e resultados                                 |
| `e0469db`, `dbe9a82`            | V2: protocolo, instrumento e sondagens                                    |
| `4ed3412`                       | sondagens P1–P4 do Ollama na V2                                           |
| `5b5338f`                       | congelamento da V2.1                                                      |
| `4703531`                       | rodadas da V2.1 do Ollama, sem aprovados                                  |
| `4d0b2c5`                       | sondagem P1–P4 do Groq na V2.1                                            |
| `dfdd8bf`                       | rodada de referência do Groq na V2.1, abortada por defeito do instrumento |
| `afe8e97`                       | critérios aprovados da V3, antes do código                                |
| `53b1f31`                       | congelamento da V3                                                        |
| `81e0a93`                       | sondagens Q1 e Q2 da V3                                                   |
| `860cc4e`                       | rodadas da V3 do Ollama, sem aprovados                                    |
| `64d567f`                       | diagnóstico das rodadas da V3                                             |
| `4e3b091`                       | auditoria dos casos contra a especificação                                |
| `eb6a725`                       | verificação de sensibilidade do gabarito                                  |
| `4cd4036`                       | decisões D25–D27 (AF v1.6, cenários v1.7)                                 |
| `66fe13d`                       | esclarecimento de "artigo aplicável" na D25                               |
| `7066b8e`                       | critérios aprovados da V4, antes do código                                |
| `13802eb`                       | congelamento do gabarito e da régua da V4                                 |
| `c8cc7f1`                       | linha de base não oficial da V4                                           |
| `331526a`                       | instruções da V4 e teste contra vazamento                                 |
| `d0dff3f`                       | ligação das instruções às tools e ao runner                               |
| `6fe0f73`                       | congelamento da V4                                                        |
| `3adb7a9`                       | rodadas da V4 do Ollama, sem aprovados                                    |
| `a6901c9`                       | diagnóstico das rodadas da V4                                             |

Os hashes são os da branch `spike/modelo-llm`, preservada pela tag `spike-adr-009`. As decisões D25–D27 chegam à `main` pelo PR deste ADR, com outros hashes.
