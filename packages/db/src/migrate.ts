#!/usr/bin/env node
/**
 * Apply the package-owned migration history as a separate process: migrating on boot would race schema
 * changes with rollout. Invoke `qcms-db-migrate` or `node --import @roonga/qcms-db/migrate --eval ""`,
 * never a deep `dist/` path, which bypasses the `exports` map.
 */
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/**
 * drizzle's wrapper says a query failed and never why, while its `cause` holds the
 * sentence an operator acts on. Whitespace collapsed to keep a container log to one line.
 */
function describeError(error: unknown): string {
  const collapse = (text: string): string => text.replaceAll(/\s+/g, " ").trim();
  if (!(error instanceof Error)) return collapse(String(error));
  const cause = error.cause;
  const because = cause instanceof Error ? ` (${collapse(cause.message)})` : "";
  return `${collapse(error.message)}${because}`;
}

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.trim() === "") {
  process.stderr.write("qcms-db migrate failed: DATABASE_URL is required\n");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const db = drizzle(pool);
const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

try {
  await migrate(db, { migrationsFolder });
  process.stdout.write("qcms-db migrations applied\n");
} catch (error) {
  // Never the connection string: it carries the database password, and this line goes to
  // a container log (SEC-8).
  process.stderr.write(`qcms-db migrate failed: ${describeError(error)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
