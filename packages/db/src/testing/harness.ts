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

const { Client, Pool } = pg;

/**
 * The Postgres image the harness boots when nothing overrides it. Pinned to the
 * same major the compose dev stack uses; `-alpine` keeps pulls small and is
 * cached across runs. A contributor on a laptop needs nothing else: this is a
 * public Docker Hub image and the pull is anonymous.
 */
export const DEFAULT_TEST_POSTGRES_IMAGE = "postgres:16-alpine";

/**
 * The Postgres image the harness boots, resolved once at module load.
 *
 * `QCMS_TEST_POSTGRES_IMAGE` overrides the default with any other reference of
 * the same Postgres major (issue #74). CI points it at a GHCR mirror of the same
 * image, because anonymous Docker Hub pulls from shared GitHub runner IP ranges
 * are rate-limited and intermittently return HTTP 500, which failed the whole
 * `@qcms/db` suite twice in one day. Read at module load rather than per call so
 * every container in a run boots the same image; set it in the environment
 * before the test process starts.
 */
export const TEST_POSTGRES_IMAGE = resolveConfiguredImage() ?? DEFAULT_TEST_POSTGRES_IMAGE;

/** The configured override, or undefined when unset or blank. */
function resolveConfiguredImage(): string | undefined {
  const configured = process.env.QCMS_TEST_POSTGRES_IMAGE?.trim();
  return configured === undefined || configured.length === 0 ? undefined : configured;
}

/** Absolute path to the package-owned migrations folder. */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url));

export interface TestDb {
  /**
   * Drizzle handle bound to the full schema, backed by a connection **pool** -
   * the same shape `serve.ts` builds in production. See {@link startTestDb} for
   * why a pool rather than a single client.
   */
  readonly db: NodePgDatabase<typeof schema>;
  /**
   * A dedicated single node-postgres connection for raw SQL in tests. Separate
   * from the pool behind {@link TestDb.db}, so it sees only committed state - do
   * not use it to observe another connection's open transaction.
   */
  readonly client: pg.Client;
  /** libpq connection string for the container. */
  readonly connectionUri: string;
  /**
   * The started Postgres container, for harnesses that need to stream its server
   * logs (e.g. the portal e2e's server-side log gate, task 045). Do not stop it
   * directly - use {@link TestDb.teardown}.
   */
  readonly container: StartedPostgreSqlContainer;
  /** Stop the client and the container. Idempotent. */
  teardown(): Promise<void>;
}

interface StartOptions {
  /** Run the full migration set after connecting (default true). */
  readonly migrate?: boolean;
  /**
   * Boot a different image than {@link TEST_POSTGRES_IMAGE}. Exists so the
   * harness's own tests can exercise the unpullable-image path; production test
   * suites should leave it unset and use `QCMS_TEST_POSTGRES_IMAGE` instead, so
   * every container in a run boots the same image.
   */
  readonly image?: string;
}

/**
 * Substrings that mark a container-start failure as an image-pull failure rather
 * than a Postgres or Docker-daemon problem. Matched case-insensitively against
 * the whole error chain. Docker surfaces registry trouble as an opaque
 * `(HTTP code 500) server error - Get "https://registry-1.docker.io/v2/": ...`,
 * so the HTTP-code shape has to be part of the signal.
 */
const PULL_FAILURE_MARKERS: readonly RegExp[] = [
  /\bpull\b/i,
  /\bregistry\b/i,
  /\bmanifest\b/i,
  /toomanyrequests/i,
  /\b(unauthorized|denied|forbidden)\b/i,
  /no such image/i,
  /HTTP code 5\d\d/i,
  /connection refused/i,
  /context deadline exceeded/i,
];

/**
 * Images whose pull has already failed in this worker process, with the message
 * to replay. A registry that cannot serve the image for one test file cannot
 * serve it for the next, and every file that tries costs another pull timeout,
 * so the second and later attempts fail immediately (issue #74). Keyed by image
 * reference: a deliberately unpullable reference in one test never poisons the
 * real one.
 */
const unpullableImages = new Map<string, string>();

/** Flatten an error and its `cause` chain into one searchable string. */
function describeCause(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 5; depth += 1) {
    if (current instanceof Error) {
      parts.push(`${current.name}: ${current.message}`);
      current = current.cause;
      continue;
    }
    // A thrown non-Error: JSON keeps an object readable, and returns undefined
    // only for values with no JSON form (a function, a symbol).
    parts.push(typeof current === "string" ? current : (JSON.stringify(current) ?? typeof current));
    current = undefined;
  }
  return parts.join(" <- ");
}

/**
 * Start the container, converting a failure into an error that names the image
 * and the registry problem.
 *
 * Without this, a pull failure throws Docker's opaque HTTP error from inside
 * `beforeAll`, the caller's `TestDb` is never assigned, and every `afterAll`
 * then throws `Cannot read properties of undefined (reading 'teardown')` - the
 * shape observed in CI, where 21 of the 24 reported errors were that cascade and
 * only 3 carried the actual cause (issue #74).
 */
async function startContainer(image: string): Promise<StartedPostgreSqlContainer> {
  const alreadyFailed = unpullableImages.get(image);
  if (alreadyFailed !== undefined) {
    throw new Error(`${alreadyFailed}\n  note: not retried (this image already failed to pull)`);
  }

  try {
    return await new PostgreSqlContainer(image).start();
  } catch (cause) {
    const detail = describeCause(cause);
    const isPullFailure = PULL_FAILURE_MARKERS.some((marker) => marker.test(detail));
    const message = [
      isPullFailure
        ? "Could not PULL the test Postgres image - the container registry failed, not Postgres."
        : "Could not START the test Postgres container.",
      `  image:  ${image}`,
      `  source: ${image === TEST_POSTGRES_IMAGE ? "TEST_POSTGRES_IMAGE" : "startTestDb({ image })"}${
        image === DEFAULT_TEST_POSTGRES_IMAGE ? " (default)" : ""
      }`,
      `  cause:  ${detail}`,
      isPullFailure
        ? "  fix:    check the registry is reachable and the tag exists, or set QCMS_TEST_POSTGRES_IMAGE" +
          ` to a mirror of the same image (default: ${DEFAULT_TEST_POSTGRES_IMAGE}).`
        : "  fix:    check that a Docker daemon is running and reachable.",
    ].join("\n");

    if (isPullFailure) unpullableImages.set(image, message);
    throw new Error(message, { cause });
  }
}

/**
 * Boot an isolated Postgres in a throwaway container and connect to it.
 *
 * With `migrate: true` (default) the database is migrated to head via the
 * package-owned migration set - the same path adopters run with
 * `drizzle-kit migrate`. Intended for one container per test file (call in
 * `beforeAll`, `teardown()` in `afterAll`); tests within a file share the
 * migrated database and isolate by using distinct IDs.
 *
 * The Drizzle handle is built over a `pg.Pool`, exactly as `serve.ts` does in
 * production, and that is a correctness requirement rather than mere realism
 * (issue #30): drizzle's node-postgres driver issues a transaction's `BEGIN` and
 * `COMMIT` on whatever client it was handed, so a handle over a single
 * `pg.Client` puts *every* concurrent transaction on one connection. Two
 * overlapping transactions then emit `BEGIN, BEGIN, ..., COMMIT, COMMIT` on one
 * backend - Postgres warns ("there is already a transaction in progress" / "there
 * is no transaction in progress"), and, worse, the two logical transactions share
 * one physical transaction, so the first `COMMIT` ends both and any
 * `pg_advisory_xact_lock` they took is released early. A pool gives each
 * transaction its own connection, so per-session lock serialization (I5) behaves
 * under test as it does in production.
 */
export async function startTestDb(options: StartOptions = {}): Promise<TestDb> {
  const container = await startContainer(options.image ?? TEST_POSTGRES_IMAGE);

  const connectionUri = container.getConnectionUri();
  const client = new Client({ connectionString: connectionUri });
  await client.connect();

  const pool = new Pool({ connectionString: connectionUri });
  // An idle pooled connection that dies (typically the container going away at
  // teardown) emits `error` on the pool; node-postgres rethrows it as an
  // unhandled error without a listener, which would red an unrelated test.
  pool.on("error", () => undefined);

  const db = drizzle(pool, { schema });

  if (options.migrate ?? true) {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  }

  let torn = false;
  return {
    db,
    client,
    connectionUri,
    container,
    async teardown() {
      if (torn) return;
      torn = true;
      await pool.end();
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
