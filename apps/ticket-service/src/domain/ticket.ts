// DM §3.2. O Ticket completo ainda não está modelado no código.
export type TicketType = "INC" | "REQ";

export type TicketCategory =
  | "ACCESS"
  | "NETWORK_VPN"
  | "HARDWARE"
  | "SOFTWARE"
  | "EMAIL"
  | "OTHER";
