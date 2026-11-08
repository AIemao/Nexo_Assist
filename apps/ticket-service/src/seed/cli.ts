// Composição do seed das fixtures (como main.ts): configuração, Prisma e Unit of Work.
// A lógica está em seed-fixtures.ts.
import { randomUUID } from "node:crypto";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client.js";
import { createUnitOfWork } from "../persistence/unit-of-work.js";
import { seedFixtures } from "./seed-fixtures.js";

async function main(): Promise<void> {
  // Mesma validação do main.ts, antes de criar o PrismaClient.
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl === "") {
    console.error("Configuração inválida: DATABASE_URL é obrigatória (ex.: file:./prisma/dev.db).");
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
  try {
    const ids = await seedFixtures(
      { unitOfWork: createUnitOfWork(prisma), eventIdGenerator: { generate: randomUUID } },
      new Date(),
    );
    console.log("Fixtures criadas ou recuperadas:");
    for (const [label, id] of Object.entries(ids)) {
      console.log(`${label} → ${id}`);
    }
  } catch (error) {
    console.error("Falha no seed:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

await main();
