// Descrições das tools e dos argumentos da V4 (v4/CRITERIA.md, "Variável", "O que as instruções
// devem ensinar > Descrições das tools e dos argumentos"). Só texto: a ligação com as tools fica para a
// Etapa 2B (v4/src/tools.ts). A estrutura dos schemas não muda.
//
// Ponto de partida: as descrições da V1 (../../src/tools.ts, congelado). Mudanças e fontes:
// - searchArticles: cobre também o relato de falha nova, antes de decidir (regra 1; AF D25, item 1).
// - listMyTickets: acrescenta quando usar, sem número de chamado (regra 6; AF §9.1).
// - proposeTicketDraft: acrescenta de onde vêm os campos (regras 8 e 9; AF D26). O resto é da V1.
// - requestHandoff: acrescenta quando usar e sem busca prévia (regra 7; AF D25).
// - .describe do query: cobre também a falha relatada (regra 1; AF D25).
// - .describe do reason: igual ao da V1.
// Nenhum outro argumento recebe .describe.

export const TOOL_DESCRIPTIONS_V4 = {
  searchArticles:
    "Busca artigos da central de ajuda de TI por palavras-chave. Use para responder dúvidas e, quando o funcionário relata uma falha nova, antes de decidir o que fazer.",
  listMyTickets:
    "Lista os chamados do funcionário autenticado. Use quando ele quer saber dos próprios chamados sem informar o número. Não recebe identificação: a sessão já a define.",
  proposeTicketDraft:
    "Propõe um rascunho de chamado para o funcionário confirmar. Só use quando todos os dados estiverem completos. Título, descrição, tipo e categoria vêm da conversa; os campos de impacto, só do que o funcionário declarou. Não informe prioridade nem prazo.",
  requestHandoff: "Pede a transferência da conversa para um analista humano. Use quando o funcionário pede para falar com uma pessoa, sem buscar antes na central de ajuda.",
} as const;

export const ARGUMENT_DESCRIPTIONS_V4 = {
  searchArticles: { query: "Palavras-chave da dúvida ou da falha relatada pelo funcionário." },
  requestHandoff: { reason: "Motivo curto do pedido." },
} as const;
