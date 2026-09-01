// Must come first: neutralizes the Docker credential-helper lookup that
// testcontainers performs at its own module-load. See the module's comment.
import "./docker-auth-config.js";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import * as schema from "../schema/index.js";

const { Client, Pool } = pg;

/**
 * The Testcontainers surface this harness uses, loaded on first container boot.
 *
 * `@testcontainers/postgresql` and `testcontainers` are **optional peer
 * dependencies** of `@qcms/db` (issue #156). They are test-only, and a Docker
 * client is not something every consumer of the runtime surface should install,
 * so they are not pulled in by default. Importing them lazily is what keeps
 * `import { withTestDb } from "@qcms/db/testing"` from throwing in a consumer
 * that has not installed them: the failure moves to the first `startTestDb()`
 * call, where it can name both packages and the command that installs them.
 */
interface TestcontainersApi {
  readonly PostgreSqlContainer: typeof import("@testcontainers/postgresql").PostgreSqlContainer;
  readonly getContainerRuntimeClient: typeof import("testcontainers").getContainerRuntimeClient;
  readonly getReaper: typeof import("testcontainers").getReaper;
}

/**
 * What an adopter is told when the optional peers are absent, instead of Node's
 * bare `Cannot find package '@testcontainers/postgresql' imported from ...`,
 * which names one package, no version, and no remedy.
 */
const MISSING_TESTCONTAINERS_MESSAGE = [
  "@qcms/db/testing could not load Testcontainers.",
  "  missing: @testcontainers/postgresql and/or testcontainers",
  "  why:     both are OPTIONAL PEER dependencies of @qcms/db. The harness is test-only, so installing" +
    " @qcms/db does not drag a Docker client into a runtime dependency tree that never boots a container.",
  "  fix:     pnpm add -D @testcontainers/postgresql testcontainers",
  "  also:    the harness needs a reachable Docker daemon once the packages are installed.",
].join("\n");

/**
 * Wordings that mean "this package is not installed" rather than "this package
 * threw". Node says `Cannot find package 'x' imported from ...`; Vitest, which is
 * how the harness is actually consumed, resolves through Vite and says
 * `Could not resolve "x" imported by "@qcms/db"`. Both shapes have to be matched
 * or the adopter-facing message is only produced under one runner.
 */
const MODULE_NOT_FOUND_MARKERS: readonly RegExp[] = [
  /cannot find (package|module)/i,
  /could not resolve/i,
  /failed to resolve/i,
];

/** True when `error` is a module-resolution failure rather than a real fault inside the package. */
function isModuleNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code: unknown = (error as { code?: unknown }).code;
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") return true;
  return MODULE_NOT_FOUND_MARKERS.some((marker) => marker.test(error.message));
}

/**
 * Import the optional peers, converting "not installed" into an actionable error.
 *
 * Only a resolution failure is rewritten. A genuine fault inside either package
 * is rethrown untouched, so this never misattributes a Testcontainers bug as a
 * missing install (the same discipline as the reaper/Postgres split below).
 * Repeat calls are free: the ESM module registry caches both imports.
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

/**
 * Hook budget for a `beforeAll`/`afterAll`/`beforeEach` that boots, seeds or tears
 * down a container-backed fixture.
 *
 * Every integration file needs one, because Vitest's default hook timeout is
 * nowhere near a container boot, and until issue #746 each file wrote out its own
 * `const BOOT_TIMEOUT = 120_000` (twenty-six of them, plus one bare `120_000` in
 * `apps/api/e2e/support/seed-fixtures.test.ts` that a search for the constant name
 * would have missed). Twenty-seven copies of a number is twenty-seven places to
 * miss when the number turns out to be wrong, so it lives here now, next to the
 * boot it is a budget for.
 *
 * **It governs both ends of the same wait**, through
 * {@link CONTAINER_STARTUP_TIMEOUT_MS}. Testcontainers' own wait strategy defaults
 * to 120s and would otherwise give up first, which is exactly what happened on the
 * gate run that followed the first version of this change: a `not bound after
 * 120000ms` failure from inside `.start()`, naming the ephemeral port Docker had
 * just mapped, while the hook that called it still held twice that budget unused. A
 * raise on one side alone is decoration.
 *
 * **Why 240s and not 120s.** A boot that takes longer than two minutes is a boot
 * under contention, not a broken one: on 2026-08-31 three untouched integration
 * files in three lanes failed this hook during a forced turbo run with 18 uncached
 * tasks booting containers at once, and each passed in seconds in isolation. The
 * work is serial per container (image lookup, daemon start, Postgres init, the
 * readiness poll) and every stage of it stretches with load, so the honest budget
 * is a multiple of the idle case rather than a tight bound on it. Doubling costs
 * nothing on a passing run - a hook timeout is only ever spent by a failing one -
 * and a genuinely stuck boot still fails in bounded time rather than hanging.
 *
 * This is deliberately NOT the per-test timeout. Tests that talk to an already
 * booted container keep their own, tighter budgets: a query that takes minutes is
 * a defect, and hiding that behind the boot's allowance is how a real hang becomes
 * a slow suite instead of a red one.
 */
export const CONTAINER_BOOT_TIMEOUT_MS = 240_000;

/**
 * What {@link startContainer} hands Testcontainers' own wait strategy: the hook
 * budget less a margin, so the container gives up FIRST.
 *
 * The margin is the whole point. With the two budgets equal, which one expires
 * first is a race, and losing it costs the diagnosis: Vitest reports `Hook timed
 * out in 240000ms` and names nothing, while this harness's message names the image,
 * where it came from, the underlying cause and what to do about it. Observed on a
 * gate run - one suite died on the opaque form while the harness sat 30s away from
 * producing the useful one. So the container is always the first to speak.
 *
 * Same derivation discipline as `apps/portal/e2e/support/portal-server.test.ts`,
 * where each per-test timeout is its inner wait plus headroom for the same reason: a
 * wait that reaches its ceiling must fail on the message that explains it.
 */
const CONTAINER_STARTUP_TIMEOUT_MS = CONTAINER_BOOT_TIMEOUT_MS - 30_000;

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
  /**
   * Bring up the Testcontainers infrastructure (the Ryuk reaper) instead of
   * {@link bootTestcontainersInfrastructure}. A test seam, like {@link
   * StartOptions.image}: a real forced reaper failure is not deterministic,
   * because Testcontainers **reuses** any reaper already running on the machine,
   * so a concurrently running test file would silently make the failure vanish.
   * Production test suites leave this unset.
   */
  readonly bootInfrastructure?: () => Promise<void>;
}

/**
 * The Ryuk reaper reference Testcontainers will boot, for error messages only.
 *
 * testcontainers-node reads `RYUK_CONTAINER_IMAGE` lazily and otherwise uses a
 * version-pinned `testcontainers/ryuk` tag of its own. The pin is deliberately
 * not duplicated here: a stale copy in an error message is worse than no copy.
 */
function describeReaperImage(): string {
  const configured = process.env.RYUK_CONTAINER_IMAGE?.trim();
  return configured === undefined || configured.length === 0
    ? "testcontainers/ryuk (testcontainers-node's pinned default)"
    : configured;
}

/**
 * Bring up the Ryuk reaper (or reuse the one already running) before any
 * container of ours.
 *
 * Testcontainers does this itself inside `.start()`, *after* pulling the
 * requested image. Doing it first, explicitly, is what makes the two failure
 * modes distinguishable: once this has returned, the reaper is up, so any later
 * registry failure during `.start()` can only be the image we asked for. That is
 * the whole point (issue #150) - a reaper pull failure used to be reported as a
 * Postgres-image pull failure, sending the reader to check a mirror that was
 * working perfectly.
 *
 * `getReaper` short-circuits to a no-op reaper when `TESTCONTAINERS_RYUK_DISABLED`
 * is `true` (CI sets it - see `.github/actions/test-postgres-image`), so on CI
 * this touches no registry at all.
 */
async function bootTestcontainersInfrastructure(): Promise<void> {
  const { getContainerRuntimeClient, getReaper } = await loadTestcontainers();
  const client = await getContainerRuntimeClient();
  await getReaper(client);
}

/**
 * Wordings that mean the Docker **daemon** could not be reached at all: no socket,
 * nothing listening on it, or no permission to open it. Matched case-insensitively
 * against the whole error chain, and matched FIRST (issue #171).
 *
 * Order is the whole point. `connection refused` and `context deadline exceeded`
 * are real registry wordings, so they belong in {@link PULL_FAILURE_MARKERS} - but
 * they are also exactly what a dead `/var/run/docker.sock` produces, and a
 * dead-socket failure classified as a pull sends the reader to check a registry,
 * a mirror and `QCMS_TEST_POSTGRES_IMAGE`, none of which are involved. That is the
 * same misattribution shape as issue #150, one layer down: the phase and the
 * connectivity of the daemon decide, and only then does the text.
 *
 * `Could not find a working container runtime strategy` is testcontainers-node's
 * own summary when every strategy failed to connect, which is the form the
 * failure usually reaches this file in.
 *
 * Every marker names the daemon or its socket. A bare errno is deliberately NOT
 * one: `connect ECONNREFUSED 127.0.0.1:1` is what a genuinely unpullable registry
 * reference produces, and a socket path or the daemon's own wording is the only
 * part of the text that separates the two.
 */
const DAEMON_FAILURE_MARKERS: readonly RegExp[] = [
  /cannot connect to the docker daemon/i,
  /is the docker daemon running/i,
  /docker daemon is not running/i,
  /could not find a working container runtime strategy/i,
  /docker\.sock/i,
];

/**
 * Substrings that mark a container-start failure as an image-pull failure rather
 * than a Postgres or Docker-daemon problem. Matched case-insensitively against
 * the whole error chain, and only once {@link DAEMON_FAILURE_MARKERS} has ruled
 * out a daemon-connectivity failure. Docker surfaces registry trouble as an opaque
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

/** What a container-start failure actually was, decided daemon-first (issue #171). */
type FailureKind = "daemon" | "pull" | "other";

/**
 * Classify a flattened error chain.
 *
 * Daemon connectivity is asked about first, so the generic registry wordings in
 * {@link PULL_FAILURE_MARKERS} cannot claim a failure that never reached a
 * registry at all.
 */
function classifyFailure(detail: string): FailureKind {
  if (DAEMON_FAILURE_MARKERS.some((marker) => marker.test(detail))) return "daemon";
  if (PULL_FAILURE_MARKERS.some((marker) => marker.test(detail))) return "pull";
  return "other";
}

/**
 * The message for a failure that happened before any Postgres container was
 * asked for: Testcontainers' own infrastructure could not come up.
 *
 * It must not name the configured Postgres image or `QCMS_TEST_POSTGRES_IMAGE`,
 * because neither is involved. That misattribution is issue #150: a Ryuk pull
 * against Docker Hub failed while the GHCR Postgres mirror was working, and the
 * error sent the reader to check the mirror.
 */
function describeInfrastructureFailure(cause: unknown): string {
  const detail = describeCause(cause);
  const kind = classifyFailure(detail);

  // A dead daemon socket is not a registry problem and names no image, so it gets
  // its own message rather than a reaper-pull one with an image and a mirror knob
  // in it (issue #171). Nothing in the Testcontainers stack works without a
  // daemon, so this is also the failure to report first when it applies.
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

/**
 * The message for "there is no Docker to talk to", from either phase.
 *
 * It names no image and no registry on purpose: neither was reached. Before issue
 * #171 this text did not exist and the failure was reported as a pull of whichever
 * image the phase was about, which sent the reader to check a mirror that was
 * fine while the socket under their feet was dead.
 */
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
 * Start the container, converting a failure into an error that names the image
 * and the registry problem.
 *
 * Without this, a pull failure throws Docker's opaque HTTP error from inside
 * `beforeAll`, the caller's `TestDb` is never assigned, and every `afterAll`
 * then throws `Cannot read properties of undefined (reading 'teardown')` - the
 * shape observed in CI, where 21 of the 24 reported errors were that cascade and
 * only 3 carried the actual cause (issue #74).
 *
 * Two failures, deliberately kept apart (issue #150). The Testcontainers
 * infrastructure comes up first, in its own step: if *that* fails, the image the
 * caller configured is not implicated and the message must not name it. Docker
 * reports a registry timeout as a bare `Get "https://registry-1.docker.io/v2/":
 * context deadline exceeded` with no image reference in it, so the phase the
 * failure came from is the only reliable signal about which image it was.
 */
async function startContainer(
  image: string,
  bootInfrastructure: () => Promise<void>,
): Promise<StartedPostgreSqlContainer> {
  const alreadyFailed = unpullableImages.get(image);
  if (alreadyFailed !== undefined) {
    throw new Error(`${alreadyFailed}\n  note: not retried (this image already failed to pull)`);
  }

  // Deliberately outside both try blocks: a missing optional peer is neither a
  // reaper failure nor an image-pull failure, and must not be described as one.
  const { PostgreSqlContainer } = await loadTestcontainers();

  try {
    await bootInfrastructure();
  } catch (cause) {
    throw new Error(describeInfrastructureFailure(cause), { cause });
  }

  try {
    // The startup budget has to be raised HERE as well as on the calling hook, or
    // raising the hook buys nothing (issue #746). Testcontainers' own wait strategy
    // defaults to 120s, so under load it gave up first and the hook's larger budget
    // was never reached: the failure arrived from inside `.start()` as a `not bound
    // after 120000ms` on the ephemeral port Docker had just mapped, with the Vitest
    // hook still holding time it could not use. The margin below the hook budget is
    // what keeps the failure diagnosable - see CONTAINER_STARTUP_TIMEOUT_MS.
    return await new PostgreSqlContainer(image)
      .withStartupTimeout(CONTAINER_STARTUP_TIMEOUT_MS)
      .start();
  } catch (cause) {
    const detail = describeCause(cause);
    const kind = classifyFailure(detail);

    // Same discrimination as the infrastructure phase, and with the same
    // consequence for the cache below: a daemon that went away is not a property
    // of this image, so it must not poison it for the rest of the run.
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
  const container = await startContainer(
    options.image ?? TEST_POSTGRES_IMAGE,
    options.bootInfrastructure ?? bootTestcontainersInfrastructure,
  );

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
