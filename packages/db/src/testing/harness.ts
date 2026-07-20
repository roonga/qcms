// Must come first: neutralizes the Docker credential-helper lookup that
// testcontainers performs at its own module-load. See the module's comment.
import "./docker-auth-config.js";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import * as schema from "../schema/index.js";

const { Client } = pg;

/**
 * The Postgres image the harness boots. Pinned to the same major the compose
 * dev stack uses; `-alpine` keeps pulls small and is cached across runs.
 */
export const TEST_POSTGRES_IMAGE = "postgres:16-alpine";

/** Absolute path to the package-owned migrations folder. */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url));

export interface TestDb {
  /** Drizzle handle bound to the full schema. */
  readonly db: NodePgDatabase<typeof schema>;
  /** The underlying node-postgres client, for raw SQL in tests. */
  readonly client: pg.Client;
  /** libpq connection string for the container. */
  readonly connectionUri: string;
  /** Stop the client and the container. Idempotent. */
  teardown(): Promise<void>;
}

interface StartOptions {
  /** Run the full migration set after connecting (default true). */
  readonly migrate?: boolean;
}

/**
 * Boot an isolated Postgres in a throwaway container and connect to it.
 *
 * With `migrate: true` (default) the database is migrated to head via the
 * package-owned migration set - the same path adopters run with
 * `drizzle-kit migrate`. Intended for one container per test file (call in
 * `beforeAll`, `teardown()` in `afterAll`); tests within a file share the
 * migrated database and isolate by using distinct IDs.
 */
export async function startTestDb(options: StartOptions = {}): Promise<TestDb> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    TEST_POSTGRES_IMAGE,
  ).start();

  const connectionUri = container.getConnectionUri();
  const client = new Client({ connectionString: connectionUri });
  await client.connect();

  const db = drizzle(client, { schema });

  if (options.migrate ?? true) {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  }

  let torn = false;
  return {
    db,
    client,
    connectionUri,
    async teardown() {
      if (torn) return;
      torn = true;
      await client.end();
      await container.stop();
    },
  };
}

/**
 * One-shot convenience: boot a migrated database, run `fn`, tear down. Use
 * `startTestDb` directly when a file needs the database across multiple tests.
 */
export async function withTestDb<T>(fn: (testDb: TestDb) => Promise<T>): Promise<T> {
  const testDb = await startTestDb();
  try {
    return await fn(testDb);
  } finally {
    await testDb.teardown();
  }
}

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

/**
 * Read the migration journal and apply the SQL files whose index falls within
 * `[from, to]` (inclusive; defaults to the whole set), in order. Bypasses
 * Drizzle's own migration tracker so a test can apply migrations one at a time
 * and observe the schema *between* them - the "apply N, then N+1" forward path.
 * Not for production use; adopters use `drizzle-kit migrate`.
 */
export async function applyMigrations(
  client: pg.Client,
  range: { from?: number; to?: number } = {},
): Promise<void> {
  const from = range.from ?? 0;
  const to = range.to ?? Number.POSITIVE_INFINITY;
  const journalPath = fileURLToPath(
    new URL("../../migrations/meta/_journal.json", import.meta.url),
  );
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: JournalEntry[] };
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);

  for (const entry of entries) {
    if (entry.idx < from || entry.idx > to) continue;
    const sqlPath = fileURLToPath(new URL(`../../migrations/${entry.tag}.sql`, import.meta.url));
    const sql = readFileSync(sqlPath, "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      await client.query(statement);
    }
  }
}
