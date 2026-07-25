import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations + shadow DB + advisory locks connect directly to
    // Postgres. No pooler in the loop, so this is simply DATABASE_URL
    // (the owner role that owns the schema).
    url: env("DATABASE_URL"),
  },
});
