/**
 * Regression coverage for the harness's Drizzle handle (issue #30).
 *
 * The portal e2e serves a real API from `startTestDb().db`, and Postgres logged
 * `there is already a transaction in progress` / `there is no transaction in
 * progress` WARNINGs during the run. The mechanism was the harness, not the API:
 * a Drizzle handle built over a single `pg.Client` has exactly one connection, so
 * `db.transaction()` issues its `BEGIN` / `COMMIT` on the connection every other
 * caller is also using. Two overlapping transactions therefore emit
 * `BEGIN, BEGIN, ..., COMMIT, COMMIT` on one backend: the second `BEGIN` is
 * redundant (already in a transaction) and the second `COMMIT` has no transaction
 * left to commit. Postgres warns and continues, and - worse than the noise - the
 * two logical transactions silently share one physical transaction, so the first
 * `COMMIT` ends both and any `pg_advisory_xact_lock` taken inside them is released
 * early. Building the handle over a `pg.Pool` (what `serve.ts` does in production)
 * gives every transaction its own connection.
 *
 * The two assertions below are the guard: concurrent transactions must land on
 * distinct backends, and the container's server log must carry neither warning.
 * The log assertion is the honest one for this symptom (the WARNING never reaches
 * the client as an error), and it fails if the redundant statements come back.
 *
 * The last two describe blocks cover the harness's failure-reporting contract. A
 * container image that cannot be pulled must be reported as a registry failure
 * naming the image, not as Docker's opaque HTTP error (issue #74) - and a failure
 * of Testcontainers' own Ryuk reaper must be reported as that, never as a failure
 * of the configured Postgres image (issue #150).
 */

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestDb, type TestDb } from "./harness.js";

const BOOT_TIMEOUT = 120_000;

/** How many transactions to run at once. Below the node-postgres default pool size. */
const CONCURRENCY = 4;

/** The two transaction-bookkeeping WARNINGs issue #30 tracked. */
const TX_WARNINGS: readonly RegExp[] = [
  /WARNING:\s+there is already a transaction in progress/,
  /WARNING:\s+there is no transaction in progress/,
];

/** A marker WARNING used to prove the container log stream has caught up. */
const LOG_MARKER = "qcms-issue-30-log-marker";

let testDb: TestDb;
/** Everything the Postgres container has written since boot. */
let serverLog = "";

beforeAll(async () => {
  testDb = await startTestDb();
  const logs = await testDb.container.logs();
  logs.on("data", (chunk: Buffer | string) => {
    serverLog += chunk.toString();
  });
  logs.on("error", () => undefined);
}, BOOT_TIMEOUT);

afterAll(async () => {
  await testDb?.teardown();
}, BOOT_TIMEOUT);

/**
 * Emit a WARNING through the raw client and wait until it shows up in the
 * captured stream, so every earlier server-log line has certainly arrived. The
 * container log stream is asynchronous; without this flush the absence of a
 * warning would prove nothing.
 */
async function flushServerLog(): Promise<void> {
  await testDb.client.query(`do $$ begin raise warning '${LOG_MARKER}'; end $$;`);
  const deadline = Date.now() + 10_000;
  while (!serverLog.includes(LOG_MARKER)) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the Postgres log marker");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("startTestDb transaction handling (issue #30)", () => {
  it("gives each concurrent transaction its own connection and logs no redundant BEGIN/COMMIT", async () => {
    const pids = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        testDb.db.transaction(async (tx) => {
          // Hold the transaction open long enough to overlap with its siblings, so
          // a shared connection would interleave their BEGIN/COMMIT statements.
          await tx.execute(sql`select pg_sleep(0.05)`);
          const result = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
          return result.rows[0]!.pid;
        }),
      ),
    );

    expect(new Set(pids).size).toBe(CONCURRENCY);

    await flushServerLog();
    const offenders = serverLog
      .split(/\r?\n/)
      .filter((line) => TX_WARNINGS.some((pattern) => pattern.test(line)));
    expect(offenders, `Postgres transaction warnings:\n${offenders.join("\n")}`).toEqual([]);
  }, 60_000);

  it("serializes concurrent transactions that take the same advisory transaction lock", async () => {
    // Invariant I5's serialization only works when each transaction is on its own
    // connection: on a shared one the lock is re-entrant (same physical
    // transaction) and both critical sections run at once.
    const lockKey = 30_000_030;
    const order: string[] = [];

    async function critical(label: string): Promise<void> {
      await testDb.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${lockKey})`);
        order.push(`${label}:in`);
        await tx.execute(sql`select pg_sleep(0.1)`);
        order.push(`${label}:out`);
      });
    }

    await Promise.all([critical("a"), critical("b")]);

    // Whoever wins, the loser cannot enter before the winner has left.
    expect(order).toHaveLength(4);
    expect(order[1]).toBe(`${order[0]!.split(":")[0]!}:out`);
  }, 60_000);
});

/**
 * A reference no registry can serve: port 1 on loopback refuses the connection
 * immediately, so the assertion never depends on a real registry's wording, on
 * network access, or on a slow timeout. The failure the harness must dress up is
 * the same class Docker Hub produced in CI (HTTP 500 from the registry).
 */
const UNPULLABLE_IMAGE = "localhost:1/qcms-no-such-image:16-alpine";

/**
 * Docker's wording for the registry timeout that failed PR #149's portal-e2e leg:
 * an HTTP 500 that names Docker Hub's v2 endpoint and **no image at all**. That
 * missing reference is why the phase a failure came from, not its text, has to
 * decide which image gets blamed (issue #150).
 */
const HUB_TIMEOUT_MESSAGE =
  '(HTTP code 500) server error - Get "https://registry-1.docker.io/v2/": context deadline exceeded';

/** Resolve to the error `startTestDb` threw, or undefined if it did not throw. */
async function captureStartFailure(
  options: Parameters<typeof startTestDb>[0],
): Promise<Error | undefined> {
  try {
    const started = await startTestDb({ migrate: false, ...options });
    await started.teardown();
    return undefined;
  } catch (error) {
    return error as Error;
  }
}

describe("startTestDb image-pull failure reporting (issue #74)", () => {
  it("reports the registry failure and the image instead of Docker's opaque error", async () => {
    const failure = await captureStartFailure({ image: UNPULLABLE_IMAGE });

    expect(failure).toBeInstanceOf(Error);
    // Everything a reader needs to diagnose a CI-side registry outage: what
    // failed, which image, and the knob that redirects it at a mirror.
    expect(failure?.message).toContain("Could not PULL the test Postgres image");
    expect(failure?.message).toContain(UNPULLABLE_IMAGE);
    expect(failure?.message).toContain("QCMS_TEST_POSTGRES_IMAGE");
    // The underlying Docker error is preserved rather than swallowed.
    expect(failure?.message).toMatch(/cause:.+localhost:1/s);
    expect(failure?.cause).toBeDefined();
    // The other direction of issue #150: a genuine image failure must not be
    // dressed up as a reaper problem either.
    expect(failure?.message).not.toContain("Ryuk");
  }, 60_000);

  it("fails the next attempt immediately rather than waiting on the registry again", async () => {
    // The image already failed in the test above (same worker process), so this
    // call must short-circuit: in CI that saves every later test file another
    // pull timeout against a registry known to be unusable.
    const failure = await captureStartFailure({ image: UNPULLABLE_IMAGE });

    expect(failure?.message).toContain("not retried");
    expect(failure?.message).toContain(UNPULLABLE_IMAGE);
  }, 60_000);
});

/**
 * Issue #150. PR #149's portal-e2e leg died on a Docker Hub timeout while the
 * GHCR Postgres mirror was pre-pulled and working; the harness reported it as
 * `Could not PULL the test Postgres image / image: <the GHCR mirror> / source:
 * TEST_POSTGRES_IMAGE`, and only the preserved `cause` showed the truth (the pull
 * was the Ryuk reaper's, from Docker Hub, which no Postgres override covers). The
 * misattribution cost a wrong diagnosis, so it gets a regression test.
 *
 * The infrastructure boot is injected rather than forced for real: Testcontainers
 * **reuses** any reaper already running on the machine, so an unreachable
 * `RYUK_CONTAINER_IMAGE` produces a failure only when no other test file happens
 * to have one up. Injecting is the deterministic form of the same failure.
 */
describe("startTestDb infrastructure failure reporting (issue #150)", () => {
  it("blames the Ryuk reaper, not the configured Postgres image", async () => {
    const failure = await captureStartFailure({
      bootInfrastructure: () => Promise.reject(new Error(HUB_TIMEOUT_MESSAGE)),
    });

    expect(failure).toBeInstanceOf(Error);
    // Names the component that actually failed, and the knobs that govern it.
    expect(failure?.message).toContain("Ryuk reaper");
    expect(failure?.message).toContain("TESTCONTAINERS_RYUK_DISABLED");
    expect(failure?.message).toContain("RYUK_CONTAINER_IMAGE");
    // And does NOT send the reader to a Postgres mirror that is working: no
    // Postgres-pull headline, no `source:` line, no QCMS_TEST_POSTGRES_IMAGE fix.
    expect(failure?.message).not.toContain("Could not PULL the test Postgres image");
    expect(failure?.message).not.toContain("source: TEST_POSTGRES_IMAGE");
    expect(failure?.message).not.toMatch(/fix:.*QCMS_TEST_POSTGRES_IMAGE/);
    // The Docker error is still preserved, as it was for image failures.
    expect(failure?.message).toContain("registry-1.docker.io");
    expect(failure?.cause).toBeDefined();
  }, 60_000);

  it("classifies a non-registry reaper failure as a start failure", async () => {
    const failure = await captureStartFailure({
      bootInfrastructure: () => Promise.reject(new Error("Failed to connect to Reaper")),
    });

    expect(failure?.message).toContain("Could not START the Testcontainers Ryuk reaper");
    expect(failure?.message).not.toContain("Could not PULL");
  }, 60_000);
});
