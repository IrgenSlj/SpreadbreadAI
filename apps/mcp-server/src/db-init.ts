import { ensurePostgresSchema, hasPostgresConfig } from "./postgres.js";

async function main() {
  if (!hasPostgresConfig()) {
    throw new Error("DATABASE_URL is required to initialize PostgreSQL schema");
  }

  await ensurePostgresSchema();
  console.log("[db-init] PostgreSQL schema is ready");
}

main().catch((error) => {
  console.error("[db-init] fatal error", error);
  process.exitCode = 1;
});
