import { randomUUID } from "node:crypto";

// Dependências de tempo e de identificadores, injetáveis nos testes.
export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  generate(): string;
}

export const systemClock: Clock = { now: () => new Date() };
export const uuidGenerator: IdGenerator = { generate: () => randomUUID() };
