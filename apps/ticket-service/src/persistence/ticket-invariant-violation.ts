import type { TicketInvariantError } from "../domain/index.js";

export class TicketInvariantViolation extends Error {
  readonly errors: TicketInvariantError[];

  constructor(errors: TicketInvariantError[]) {
    super(`Ticket viola invariantes: ${errors.join(", ")}`);
    this.name = "TicketInvariantViolation";
    this.errors = errors;
  }
}
