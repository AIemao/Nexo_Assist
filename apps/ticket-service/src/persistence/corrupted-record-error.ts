// Linha do banco que viola uma regra que o repositório garante na gravação.
export class CorruptedRecordError extends Error {
  readonly table: string;
  readonly id: string;

  constructor(table: string, id: string, detail: string) {
    super(`Registro corrompido em ${table} (id ${id}): ${detail}`);
    this.name = "CorruptedRecordError";
    this.table = table;
    this.id = id;
  }
}
