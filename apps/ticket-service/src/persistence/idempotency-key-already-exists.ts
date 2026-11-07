export class IdempotencyKeyAlreadyExists extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`Chave de idempotência já registrada: ${key}`);
    this.name = "IdempotencyKeyAlreadyExists";
    this.key = key;
  }
}
