// SPIKE (descartável). O Prisma 7 não lê .env sozinho; o padrão aponta para um banco
// local de desenvolvimento, e os testes passam DATABASE_URL com um arquivo temporário.
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"] ?? "file:./prisma/dev.db",
  },
});
