import "dotenv/config";
import { defineConfig } from "prisma/config";

const databaseUrl =
  process.env["DATABASE_URL"] ??
  "postgresql://gladiators:gladiators@localhost:5432/gladiators_online";

export default defineConfig({
  schema: "apps/api/prisma/schema.prisma",
  migrations: {
    path: "apps/api/prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
