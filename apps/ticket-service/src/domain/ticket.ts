// DM §3.2. O Ticket completo ainda não está modelado no código.
export const TICKET_TYPES = ["INC", "REQ"] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const TICKET_CATEGORIES = [
  "ACCESS",
  "NETWORK_VPN",
  "HARDWARE",
  "SOFTWARE",
  "EMAIL",
  "OTHER",
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
