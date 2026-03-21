import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

type PgClient = {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  release(): void;
};

type PgPool = {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  connect(): Promise<PgClient>;
  end(): Promise<void>;
};

const require = createRequire(import.meta.url);
const schemaFilePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../sql/001_initial_schema.sql",
);

let poolInstance: PgPool | null = null;
let schemaInitPromise: Promise<void> | null = null;

function getDatabaseUrl() {
  return process.env.DATABASE_URL ?? "";
}

export function getPostgresConnectionInfo() {
  const connectionString = getDatabaseUrl().trim();

  if (!connectionString) {
    return null;
  }

  try {
    const parsed = new URL(connectionString);
    return {
      host: parsed.hostname,
      port: parsed.port || "5432",
      database: parsed.pathname.replace(/^\//, "") || "postgres",
      user: decodeURIComponent(parsed.username || ""),
    };
  } catch {
    return {
      host: "unknown",
      port: "5432",
      database: "unknown",
      user: "",
    };
  }
}

function loadPgPoolConstructor(): new (input: { connectionString: string }) => PgPool {
  try {
    const loaded = require("pg") as { Pool: new (input: { connectionString: string }) => PgPool };
    return loaded.Pool;
  } catch (error) {
    throw new Error(
      "DATABASE_URL is set but the 'pg' package is not installed in apps/mcp-server.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

export function hasPostgresConfig() {
  return getDatabaseUrl().trim().length > 0;
}

export function getPostgresPool(): PgPool {
  if (poolInstance) {
    return poolInstance;
  }

  const connectionString = getDatabaseUrl().trim();

  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  const Pool = loadPgPoolConstructor();
  poolInstance = new Pool({ connectionString });
  return poolInstance;
}

export async function ensurePostgresSchema() {
  if (!schemaInitPromise) {
    schemaInitPromise = (async () => {
      const sql = await readFile(schemaFilePath, "utf8");
      await getPostgresPool().query(sql);
    })();
  }

  return schemaInitPromise;
}

export async function withTransaction<T>(operation: (client: PgClient) => Promise<T>): Promise<T> {
  await ensurePostgresSchema();
  const client = await getPostgresPool().connect();

  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
