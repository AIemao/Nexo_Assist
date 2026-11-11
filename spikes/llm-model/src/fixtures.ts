// Dados fixos das tools falsas, tirados das fixtures dos cenários
// (docs/evaluation/01-evaluation-scenarios.md v1.6, §2). O spike usa os rótulos
// (`TKT-A1`…) como id: no sistema real o id é alocado pelo ticket-service (cenários §2.1, S3).

// O funcionário da sessão em todos os casos (cenários §2: `EMP-A` "é quem conversa nos
// cenários"). A identidade nunca vem do modelo (README §8; ADR-004).
export const SESSION_EMPLOYEE_ID = "EMP-A";

export interface FixtureArticle {
  id: string;
  title: string;
  content: string;
  keywords: string[];
  applicability?: { operatingSystems: string[] };
}

export const ARTICLES: readonly FixtureArticle[] = [
  {
    id: "ART-HORARIO",
    title: "Horário do service desk",
    // Conteúdo: o artigo de exemplo citado no README §12 #4 ("seg–sex, 8h–18h; plantão
    // crítico 24h"), lá registrado como evidência, não como especificação.
    content:
      "O service desk atende de segunda a sexta-feira, das 8h às 18h. Incidentes críticos têm plantão 24 horas.",
    keywords: ["horario", "atendimento", "expediente", "funcionamento", "servicedesk"],
  },
  {
    id: "ART-VPN-809",
    title: "VPN: erro 809",
    // [Premissa do spike] Nenhum documento define o texto deste artigo; os cenários só
    // definem o assunto e a `applicability` para Windows 10 (cenários §2; DM §3.11).
    content:
      "Erro 809 na VPN do Windows 10: reinicie o serviço de VPN, confira se a rede permite a conexão e tente de novo. Se persistir, abra um chamado.",
    keywords: ["vpn", "809"],
    applicability: { operatingSystems: ["Windows 10"] },
  },
];

export interface FixtureTicket {
  id: string;
  requesterId: string;
  type: "INC" | "REQ";
  category: string;
  title: string;
  priority: string;
  status: string;
}

// Cenários §2, "Dados de criação dos chamados". `TKT-B1` existe, mas pertence a `EMP-B`:
// nunca aparece na listagem de `EMP-A` (controle negativo do filtro por solicitante, SC-04).
export const TICKETS: readonly FixtureTicket[] = [
  { id: "TKT-A1", requesterId: "EMP-A", type: "INC", category: "HARDWARE", title: "Notebook lento", priority: "MEDIUM", status: "WAITING_ANALYST" },
  { id: "TKT-A2", requesterId: "EMP-A", type: "INC", category: "ACCESS", title: "Senha do SAP não funciona", priority: "MEDIUM", status: "RESOLVED" },
  { id: "TKT-B1", requesterId: "EMP-B", type: "INC", category: "HARDWARE", title: "Tecla solta no teclado reserva", priority: "LOW", status: "WAITING_ANALYST" },
];

// Normalização de texto livre (CRITERIA.md, "Representação"): sem acentos, minúsculas,
// só letras e algarismos. "Serviço de VPN" → "servicodevpn"; "Windows 10" → "windows10".
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
