#!/usr/bin/env node
/**
 * Apply the package-owned migration history to a configured database.
 *
 * This is intentionally a separate, explicit process. Application containers
 * never migrate on boot: in a multi-instance deployment that would make schema
 * changes race with rollout, and it removes the operator's control of upgrades.
 *
 * **How to run it** (issue #294). Two supported entry points, both of them real
 * resolutions rather than a guess at this package's build layout:
 *
 * - the `qcms-db-migrate` bin, which is what `docker-compose.yml` runs and what an
 *   adopter gets on their `node_modules/.bin` PATH;
 * - the `@qcms/db/migrate` export, for a composition that would rather preload it
 *   (`node --import @qcms/db/migrate --eval ""`).
 *
 * A deep path into `dist/` is neither. It worked only because a filesystem path
 * bypasses the `exports` map, so the layout this package is free to change was
 * pinned by a caller outside it.
 *
 * **Every failure exits 1 with one line on stderr**, in the `qcms-db migrate
 * failed: ...` shape the missing-DATABASE_URL branch below already used. An
 * operator reads this in `docker compose run --rm migrate` output at step 4 of an
 * upgrade, where a Node `ERR_UNHANDLED_REJECTION` stack is noise around the one
 * sentence that matters. `exitCode` rather than `exit()` so the pool still closes.
 */
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/**
 * One line, cause included. Drizzle wraps a driver failure in a `Failed query: ...`
 * error whose own message spans several lines and whose `cause` holds the sentence
 * an operator acts on (`ECONNREFUSED`, `password authentication failed`). Reporting
 * only the wrapper says a query failed and never says why; reporting the raw
 * multi-line message breaks the one-failure-one-line shape a container log is read
 * in. So: whitespace collapsed, one level of `cause` appended.
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
  // Never the connection string: it carries the database password, and this line
  // goes to a container log an operator may paste into an issue (SEC-8).
  process.stderr.write(`qcms-db migrate failed: ${describeError(error)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
