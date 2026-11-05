// ADR-008. O Prisma 7 não carrega .env sozinho: sem DATABASE_URL, usa o banco
// local de desenvolvimento.
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
