// DM §3.16.
export const TICKET_OPERATION_TYPES = ["CREATE", "UPDATE", "REOPEN", "TRANSFER"] as const;
export type TicketOperationType = (typeof TICKET_OPERATION_TYPES)[number];
