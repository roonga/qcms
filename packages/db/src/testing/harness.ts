// Must come first: neutralizes the Docker credential-helper lookup that testcontainers
// performs at its own module load.
import "./docker-auth-config.js";

import { readFileSync } from "node:fs";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import { SEED_WORKSPACE_ID, ensureSeedWorkspace } from "../queries/workspaces.js";
import * as schema from "../schema/index.js";

import { hostSnapshotLine } from "./host-snapshot.js";
import {
  annotateWithHostSnapshot,
  instrumentPool,
  instrumentQueryable,
} from "./pool-contention.js";
import {
  createHarnessTeardown,
  describeDrainFailure,
  type DrainableConnection,
  type HarnessTeardown,
} from "./teardown.js";

export type { DrainableConnection } from "./teardown.js";

/** The workspace a migrated harness database is seeded with. */
export { SEED_WORKSPACE_ID };

/** The effective-privilege map the restore gates compare for equality. */
export { PRIVILEGE_MAP_SQL } from "./privilege-map.js";

const { Client, Pool } = pg;

/** Loaded on first container boot: both packages are optional peer dependencies. */
interface TestcontainersApi {
  readonly PostgreSqlContainer: typeof import("@testcontainers/postgresql").PostgreSqlContainer;
  readonly getContainerRuntimeClient: typeof import("testcontainers").getContainerRuntimeClient;
  readonly getReaper: typeof import("testcontainers").getReaper;
}

/**
 * The started-container surface {@link TestDb} publishes. Hand-written and narrowed because
 * naming an upstream type here would put the optional peers into the emitted `.d.ts`, where
 * an adopter who did not install them could not typecheck.
 */
export interface StartedTestPostgres {
  /** Stream the container's server log. */
  logs(options?: { since?: number; tail?: number }): Promise<Readable>;
  /** The libpq connection string. */
  getConnectionUri(): string;
  /** Run a command inside the container, to reach the server's own binaries. */
  exec(command: string[]): Promise<{ readonly exitCode: number; readonly output: string }>;
  /** Do not call this directly - use {@link TestDb.teardown}, which is idempotent. */
  stop(): Promise<unknown>;
}

const MISSING_TESTCONTAINERS_MESSAGE = [
  "@roonga/qcms-db/testing could not load Testcontainers.",
  "  missing: @testcontainers/postgresql and/or testcontainers",
  "  why:     both are OPTIONAL PEER dependencies of @roonga/qcms-db. The harness is test-only, so installing" +
    " @roonga/qcms-db does not drag a Docker client into a runtime dependency tree that never boots a container.",
  "  fix:     pnpm add -D @testcontainers/postgresql testcontainers",
  "  also:    the harness needs a reachable Docker daemon once the packages are installed.",
].join("\n");

/** Node and Vite word this differently, and both have to match. */
const MODULE_NOT_FOUND_MARKERS: readonly RegExp[] = [
  /cannot find (package|module)/i,
  /could not resolve/i,
  /failed to resolve/i,
];

function isModuleNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code: unknown = (error as { code?: unknown }).code;
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") return true;
  return MODULE_NOT_FOUND_MARKERS.some((marker) => marker.test(error.message));
}

/**
 * Only a resolution failure is rewritten, so a genuine fault inside either package is never
 * misattributed to a missing install.
 */
async function loadTestcontainers(): Promise<TestcontainersApi> {
  try {
    const [postgresql, testcontainers] = await Promise.all([
      import("@testcontainers/postgresql"),
      import("testcontainers"),
    ]);
    return {
      PostgreSqlContainer: postgresql.PostgreSqlContainer,
      getContainerRuntimeClient: testcontainers.getContainerRuntimeClient,
      getReaper: testcontainers.getReaper,
    };
  } catch (cause) {
    if (!isModuleNotFound(cause)) throw cause;
    throw new Error(MISSING_TESTCONTAINERS_MESSAGE, { cause });
  }
}

/** The image booted when nothing overrides it, pinned to the compose stack's major. */
export const DEFAULT_TEST_POSTGRES_IMAGE = "postgres:16-alpine";

/**
 * The image the harness boots. `QCMS_TEST_POSTGRES_IMAGE` overrides it with any other
 * reference of the same Postgres major, and is read once at module load, so set it in the
 * environment before the test process starts.
 */
export const TEST_POSTGRES_IMAGE = resolveConfiguredImage() ?? DEFAULT_TEST_POSTGRES_IMAGE;

function resolveConfiguredImage(): string | undefined {
  const configured = process.env.QCMS_TEST_POSTGRES_IMAGE?.trim();
  return configured === undefined || configured.length === 0 ? undefined : configured;
}

/**
 * Hook budget for a `beforeAll`/`afterAll`/`beforeEach` that boots, seeds or tears down a
 * container-backed fixture. Sized for a boot under contention, not an idle one.
 *
 * Not a per-test timeout: tests against an already booted container keep tighter budgets, so
 * a real hang stays red instead of becoming a slow suite.
 */
export const CONTAINER_BOOT_TIMEOUT_MS = 240_000;

/**
 * Below the hook budget, so the container gives up first and the failure carries this
 * harness's diagnostic message rather than Vitest's bare hook timeout.
 */
const CONTAINER_STARTUP_TIMEOUT_MS = CONTAINER_BOOT_TIMEOUT_MS - 30_000;

/** Absolute path to the package-owned migrations folder. */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url));

/**
 * The environment the harness's connections resolve in unless a caller says otherwise.
 * `prod` has no address prefix and no entry restrictions, so it is the ordinary path.
 */
export const DEFAULT_TEST_ENVIRONMENT = "prod";

/**
 * The libpq `options` string that puts a connection on one environment's search path. Data
 * plane first and no `public`, which is the order ADR-40 fixes.
 */
export function searchPathOptions(environment: string): string {
  return `-c search_path=data_${environment},control`;
}

/** One booted container and the connections the harness opened against it. */
export interface TestDb {
  /** Drizzle handle bound to the full schema, backed by a connection pool. */
  readonly db: NodePgDatabase<typeof schema>;
  /**
   * A dedicated connection for raw SQL. It sees only committed state, so it cannot observe
   * another connection's open transaction.
   */
  readonly client: pg.Client;
  /** libpq connection string for the container. */
  readonly connectionUri: string;
  /** The started container. Do not stop it directly - use {@link TestDb.teardown}. */
  readonly container: StartedTestPostgres;
  /**
   * Hand a pool or client this file opened against {@link TestDb.connectionUri} to the
   * harness, so {@link TestDb.teardown} drains it before the container stops. Returns its
   * argument. Use it instead of a second `afterAll`, which cannot guarantee the order.
   */
  register<T extends DrainableConnection>(connection: T, label: string): T;
  /** Drain every registered connection, then stop the container. Idempotent. */
  teardown(): Promise<void>;
}

interface StartOptions {
  /** Run the full migration set after connecting (default true). */
  readonly migrate?: boolean;
  /**
   * Which environment the harness's connections resolve unqualified names in (default
   * {@link DEFAULT_TEST_ENVIRONMENT}). A test that needs two at once opens its own second
   * pool against {@link TestDb.connectionUri} and registers it.
   */
  readonly environment?: string;
  /**
   * Boot a different image than {@link TEST_POSTGRES_IMAGE}. A test seam for the
   * unpullable-image path; production suites use `QCMS_TEST_POSTGRES_IMAGE` instead.
   */
  readonly image?: string;
  /**
   * Bring up the Testcontainers infrastructure (the Ryuk reaper) instead of
   * {@link bootTestcontainersInfrastructure}. A test seam: Testcontainers reuses any reaper
   * already running, so a real forced reaper failure is not deterministic.
   */
  readonly bootInfrastructure?: () => Promise<void>;
  /**
   * Seed the one workspace every control-plane fixture needs (default true). Form and
   * question `workspace_id` are `NOT NULL` with no default (ADR-41). Pass `false` for a
   * migrated database with no workspace.
   */
  readonly seedWorkspace?: boolean;
}

/**
 * Upstream's own version pin is deliberately not duplicated: a stale copy in an error
 * message is worse than no copy.
 */
function describeReaperImage(): string {
  const configured = process.env.RYUK_CONTAINER_IMAGE?.trim();
  return configured === undefined || configured.length === 0
    ? "testcontainers/ryuk (testcontainers-node's pinned default)"
    : configured;
}

/**
 * Testcontainers would do this inside `.start()`, after pulling the requested image. Doing
 * it first means any later registry failure during `.start()` can only be the Postgres
 * image, so the two are not confused.
 */
async function bootTestcontainersInfrastructure(): Promise<void> {
  const { getContainerRuntimeClient, getReaper } = await loadTestcontainers();
  const client = await getContainerRuntimeClient();
  await getReaper(client);
}

/**
 * Matched before {@link PULL_FAILURE_MARKERS}: wordings like `connection refused` come from
 * both a dead socket and a real registry failure. Every marker must name the daemon or its
 * socket, never a bare errno, which an unpullable reference also produces.
 */
const DAEMON_FAILURE_MARKERS: readonly RegExp[] = [
  /cannot connect to the docker daemon/i,
  /is the docker daemon running/i,
  /docker daemon is not running/i,
  /could not find a working container runtime strategy/i,
  /docker\.sock/i,
];

/**
 * Checked only once {@link DAEMON_FAILURE_MARKERS} has ruled out a daemon failure. Docker
 * surfaces registry trouble as an opaque HTTP 5xx, so that shape is part of the signal.
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
 * So later files fail immediately instead of each paying another pull timeout. Keyed by
 * image reference, so a deliberately unpullable reference never poisons the real one.
 */
const unpullableImages = new Map<string, string>();

function describeCause(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 5; depth += 1) {
    if (current instanceof Error) {
      parts.push(`${current.name}: ${current.message}`);
      current = current.cause;
      continue;
    }
    // A thrown non-Error: `JSON.stringify` returns undefined only for a value with no JSON
    // form, such as a function or a symbol.
    parts.push(typeof current === "string" ? current : (JSON.stringify(current) ?? typeof current));
    current = undefined;
  }
  return parts.join(" <- ");
}

type FailureKind = "daemon" | "pull" | "other";

/**
 * Daemon connectivity is asked about first, so the generic registry wordings cannot claim a
 * failure that never reached a registry.
 */
function classifyFailure(detail: string): FailureKind {
  if (DAEMON_FAILURE_MARKERS.some((marker) => marker.test(detail))) return "daemon";
  if (PULL_FAILURE_MARKERS.some((marker) => marker.test(detail))) return "pull";
  return "other";
}

/**
 * Must not name the configured Postgres image or `QCMS_TEST_POSTGRES_IMAGE`: no Postgres
 * container was asked for yet, so neither is involved.
 */
function describeInfrastructureFailure(cause: unknown): string {
  const detail = describeCause(cause);
  const kind = classifyFailure(detail);

  // A dead daemon socket is not a registry problem and names no image, so it gets its own
  // message rather than a reaper-pull one with a mirror knob in it.
  if (kind === "daemon") return describeDaemonFailure(detail);

  return [
    kind === "pull"
      ? "Could not PULL the Testcontainers Ryuk reaper image - Testcontainers' own infrastructure failed, NOT the test Postgres image."
      : "Could not START the Testcontainers Ryuk reaper - Testcontainers' own infrastructure failed, NOT the test Postgres image.",
    "  component: Testcontainers Ryuk reaper (boots before any container of ours)",
    `  image:     ${describeReaperImage()}`,
    `  cause:     ${detail}`,
    "  fix:       on ephemeral CI runners set TESTCONTAINERS_RYUK_DISABLED=true (nothing needs reaping" +
      " when the runner is destroyed); otherwise point RYUK_CONTAINER_IMAGE at a reachable mirror of the reaper.",
    `  note:      QCMS_TEST_POSTGRES_IMAGE does not cover this image - it redirects only Postgres (currently ${TEST_POSTGRES_IMAGE}).`,
  ].join("\n");
}

/** Names no image and no registry on purpose: neither was reached. */
function describeDaemonFailure(detail: string): string {
  return [
    "Could not REACH the Docker daemon - no container was started and no registry was contacted.",
    "  component: Docker daemon (everything Testcontainers does goes through it)",
    `  host:      ${process.env.DOCKER_HOST?.trim() ?? "<DOCKER_HOST unset: the platform default socket>"}`,
    `  cause:     ${detail}`,
    "  fix:       start Docker (Docker Desktop, or `systemctl start docker`), and check DOCKER_HOST" +
      " and the socket's permissions if it is running. Inside the dev container the host socket is" +
      " bind-mounted, so a daemon stopped on the host looks exactly like this from in there.",
    "  note:      this is NOT an image-pull failure. QCMS_TEST_POSTGRES_IMAGE and RYUK_CONTAINER_IMAGE" +
      " change which registry is used and neither is involved when the daemon itself is unreachable.",
  ].join("\n");
}

/**
 * The infrastructure comes up in its own step first because Docker reports a registry
 * failure with no image reference in it: the phase is the only signal about which image
 * failed.
 */
async function startContainer(
  image: string,
  bootInfrastructure: () => Promise<void>,
): Promise<StartedTestPostgres> {
  const alreadyFailed = unpullableImages.get(image);
  if (alreadyFailed !== undefined) {
    // A fresh snapshot: the machine has moved on since the cached text was written.
    throw new Error(
      `${alreadyFailed}\n  note: not retried (this image already failed to pull)\n${hostSnapshotLine()}`,
    );
  }

  // Outside both try blocks: a missing optional peer is neither a reaper failure nor an
  // image-pull failure, and must not be described as one.
  const { PostgreSqlContainer } = await loadTestcontainers();

  try {
    await bootInfrastructure();
  } catch (cause) {
    throw new Error(describeInfrastructureFailure(cause), { cause });
  }

  try {
    // Needed as well as the calling hook's budget: upstream's own default is shorter and
    // would give up first, naming only an ephemeral port.
    return await new PostgreSqlContainer(image)
      .withStartupTimeout(CONTAINER_STARTUP_TIMEOUT_MS)
      .start();
  } catch (cause) {
    const detail = describeCause(cause);
    const kind = classifyFailure(detail);

    // A daemon that went away is not a property of this image, so it must not poison it in
    // the cache below for the rest of the run.
    if (kind === "daemon") throw new Error(describeDaemonFailure(detail), { cause });

    const isPullFailure = kind === "pull";
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

    // The snapshot is appended to what is thrown, never to what is cached: a frozen one
    // would report the machine as it stood at an earlier test's failure.
    if (isPullFailure) unpullableImages.set(image, message);
    throw new Error(`${message}\n${hostSnapshotLine()}`, { cause });
  }
}

/**
 * Boot an isolated Postgres in a throwaway container and connect to it, migrated to head
 * unless `migrate` says otherwise. One container per test file: call it in `beforeAll` and
 * `teardown()` in `afterAll`.
 *
 * The Drizzle handle is over a `pg.Pool` for correctness, not realism: on a single
 * `pg.Client` two overlapping transactions would share one physical transaction.
 */
export async function startTestDb(options: StartOptions = {}): Promise<TestDb> {
  const container = await startContainer(
    options.image ?? TEST_POSTGRES_IMAGE,
    options.bootInfrastructure ?? bootTestcontainersInfrastructure,
  );

  const connectionUri = container.getConnectionUri();

  const teardown = createHarnessTeardown(container);

  const environment = options.environment ?? DEFAULT_TEST_ENVIRONMENT;
  // Harmless before the migration: Postgres ignores a missing schema on the search path.
  const searchPath = searchPathOptions(environment);

  const client = new Client({ connectionString: connectionUri, options: searchPath });
  // Registered before connecting: the `error` guard must be attached before there is a
  // connection to lose.
  teardown.register(client, "dedicated client");
  try {
    await client.connect();
  } catch (cause) {
    // pg's wording for a refused or timed-out connect names nothing about the machine.
    annotateWithHostSnapshot(cause);
    await stopAfterFailedStart(teardown);
    throw cause;
  }

  const pool = new Pool({ connectionString: connectionUri, options: searchPath });
  teardown.register(pool, "pool");

  // Both halves: a transaction's statements run on a checked-out client, not on the pool.
  instrumentPool(pool);
  instrumentQueryable(client);

  const db = drizzle(pool, { schema });

  if (options.migrate ?? true) {
    try {
      await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    } catch (cause) {
      // No `TestDb` reaches the caller, so no `afterAll` of theirs can tear this down.
      await stopAfterFailedStart(teardown);
      throw cause;
    }
    if (options.seedWorkspace ?? true) {
      try {
        await ensureSeedWorkspace(db);
      } catch (cause) {
        await stopAfterFailedStart(teardown);
        throw cause;
      }
    }
  }

  return {
    db,
    client,
    connectionUri,
    container,
    register<T extends DrainableConnection>(connection: T, label: string): T {
      return teardown.register(connection, label);
    },
    async teardown(): Promise<void> {
      await teardown.run();
    },
  };
}

/**
 * A teardown failure here becomes a process warning rather than replacing the caller's
 * error, which is the only fact they can act on.
 */
async function stopAfterFailedStart(teardown: HarnessTeardown): Promise<void> {
  try {
    await teardown.run();
  } catch (teardownFailure) {
    // `describeDrainFailure` rather than `.message`, which is a constant naming no
    // connection.
    process.emitWarning(
      `@roonga/qcms-db/testing: teardown after a failed start: ${describeDrainFailure(teardownFailure)}`,
    );
  }
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
 * Apply the migration SQL files whose journal index falls within `[from, to]` (inclusive,
 * defaults to all), in order. Bypasses Drizzle's migration tracker, so a test can observe
 * the schema between two migrations. Not for production use.
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
