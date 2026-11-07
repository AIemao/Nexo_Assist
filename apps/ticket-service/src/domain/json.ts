// DM §3.16. Valor serializável em JSON; o domínio não depende dos tipos do Prisma.
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
