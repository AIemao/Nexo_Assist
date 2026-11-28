// Falhas classificadas das leituras de chamados. O nome da classe é o errorType do registro: nunca
// entram employeeId, ticketId, argumentos nem o corpo da resposta.
export class TicketServiceUnavailableError extends Error {
  constructor() {
    super("ticket-service indisponível depois das tentativas");
    this.name = "TicketServiceUnavailableError";
  }
}

// Resposta que o BFF não deveria provocar: outro 4xx, 404 com outro código ou corpo fora do contrato.
export class TicketServiceRejectedError extends Error {
  constructor() {
    super("resposta do ticket-service fora do esperado");
    this.name = "TicketServiceRejectedError";
  }
}
