# ADR-003 — Central de ajuda no web, busca lexical, sem embeddings

- **Status:** Aceito
- **Data:** 2026-11-02
- **Bloco:** 1

Como o agent encontra o artigo certo, e quem decide se ele se aplica ao caso?

## Contexto

O agent deve responder com base em artigos de conhecimento (README §10, "Resposta fundamentada em artigo"). O conjunto é pequeno: 5–10 artigos curtos (README §3). Alguns artigos só valem para certo ambiente. Por exemplo, a instrução de VPN para Windows 10 não se aplica a Windows 11, e nesse caso o agent deve propor um chamado (README §10).

## Decisão

Os artigos ficam em JSON, em um módulo de conhecimento do `web` (README §5). O ticket-service não vira um serviço genérico de dados. A busca é **lexical** (título, conteúdo, `keywords`), seguida de um **filtro determinístico de aplicabilidade** feito pelo código (DM §3.11). O agent usa o resultado como evidência da resposta.

## Alternativas consideradas

### A. Colocar todos os artigos no prompt

É a alternativa concorrente mais forte. Com 5–10 artigos curtos, tudo cabe no contexto, sem busca e sem módulo de retrieval. Reconhecemos esse mérito: a rejeição não se apoia em limite de contexto, que hoje não existe. Ela se apoia em três pontos:
- A aplicabilidade ficaria a critério do modelo. "Windows 10 versus 11" é uma regra que o código deve garantir, não uma instrução que o modelo deve lembrar.
- Sem seleção e registro pelo backend, não há evidência inequívoca de qual artigo fundamentou a resposta.
- Todos os artigos seriam enviados a cada turno, com consumo de tokens repetido.

### B. Busca vetorial com embeddings

Melhora a recuperação por sinônimos e semelhança semântica. Foi rejeitada porque a infraestrutura e a complexidade são desproporcionais a poucos artigos curtos em um domínio controlado (README §3, "Fora").

## Consequências

**Positivas**
- Baixo custo e pouca infraestrutura.
- Aplicabilidade previsível e testável (README §10).
- Evidência rastreável do que foi recuperado.

**Negativas e custos**
- A busca lexical pode perder correspondências semânticas.
- Exige manter os termos e os metadados (`keywords`, `applicability`) dos artigos.

## E se o produto crescer para 20 mil funcionários?

O número de funcionários não aumenta, por si só, a quantidade de artigos. O eixo relevante aqui é o **volume de conteúdo**.

**Permanece:** o filtro determinístico de aplicabilidade e o registro de quais artigos serviram de evidência.

**Pode evoluir:** com centenas de artigos, busca híbrida (lexical e vetorial) pode fazer sentido. É hipótese futura, não aprovada nem implementada, e não dispensa o filtro de aplicabilidade.

## Rastreabilidade

- README §3 ("Fora"), §5 (módulo de conhecimento) e §10 (cenários de artigo e `applicability`).
- Domain Model v2.2: §3.11 (`KnowledgeArticle`).
