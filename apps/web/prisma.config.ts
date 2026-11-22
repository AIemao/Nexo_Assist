// ADR-011 (lições do ADR-008). O Prisma 7 não carrega .env sozinho: sem WEB_DATABASE_URL, usa o
// banco local de desenvolvimento do web, separado do banco do ticket-service.
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["WEB_DATABASE_URL"] ?? "file:./prisma/web-dev.db",
  },
});
