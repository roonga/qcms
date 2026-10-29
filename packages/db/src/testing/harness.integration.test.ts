/**
 * Requires Docker. Postgres reports a shared physical transaction as a WARNING that
 * never reaches the client, so the container's server log is the only instrument.
 */

import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CONTAINER_BOOT_TIMEOUT_MS,
  startTestDb,
  TEST_POSTGRES_IMAGE,
  type TestDb,
} from "./harness.js";
import { HOST_SNAPSHOT_PREFIX } from "./host-snapshot.js";

/** Below the node-postgres default pool size. */
const CONCURRENCY = 4;

const TX_WARNINGS: readonly RegExp[] = [
  /WARNING:\s+there is already a transaction in progress/,
  /WARNING:\s+there is no transaction in progress/,
];

const LOG_MARKER = "qcms-issue-30-log-marker";

let testDb: TestDb;
let serverLog = "";

beforeAll(async () => {
  testDb = await startTestDb();
  const logs = await testDb.container.logs();
  logs.on("data", (chunk: Buffer | string) => {
    serverLog += chunk.toString();
  });
  logs.on("error", () => undefined);
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

/** The container log stream is asynchronous, so an absence proves nothing unflushed. */
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
    // On a shared connection the lock is re-entrant, so both sections would run at once.
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

    expect(order).toHaveLength(4);
    expect(order[1]).toBe(`${order[0]!.split(":")[0]!}:out`);
  }, 60_000);
});

/**
 * A literal v4 address, because `localhost:1` can resolve to `[::1]`, which
 * black-holes instead of refusing and costs Docker its whole dial timeout.
 */
const UNPULLABLE_REGISTRY = "127.0.0.1:1";

const UNPULLABLE_IMAGE = `${UNPULLABLE_REGISTRY}/qcms-no-such-image:16-alpine`;

/**
 * `String.prototype.replace` with a string pattern rewrites the first match only,
 * which would leave the remaining metacharacters as wildcards.
 *
 * @param literal text to match literally
 */
function escapeForRegExp(literal: string): string {
  return literal.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

/** The replay cache is keyed by image reference, so sharing one couples two cases. */
const UNPULLABLE_IMAGE_FOR_REPLAY = `${UNPULLABLE_REGISTRY}/qcms-no-such-image-replay:16-alpine`;

/** Docker's own wording for a registry timeout, which names no image at all. */
const HUB_TIMEOUT_MESSAGE =
  '(HTTP code 500) server error - Get "https://registry-1.docker.io/v2/": context deadline exceeded';

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

describe("startTestDb teardown ordering (issue #888)", () => {
  it(
    "hands back a checked-out pooled client and stops the container only after the drain",
    async () => {
      const pinned = await startTestDb({ migrate: false });
      const pool = pinned.register(
        new pg.Pool({ connectionString: pinned.connectionUri, max: 4 }),
        "pin pool",
      );
      const held = await pool.connect();
      // `pool.end()` cannot settle while this client is checked out.
      await held.query("select 1");
      expect(pool.totalCount).toBeGreaterThan(0);

      const container: { stop: () => Promise<unknown> } = pinned.container;
      const realStop = container.stop.bind(container);
      let atStop: { pooled: number; clientOpen: boolean } | undefined;
      container.stop = async () => {
        atStop = {
          pooled: pool.totalCount,
          clientOpen: await pinned.client.query("select 1").then(
            () => true,
            () => false,
          ),
        };
        return realStop();
      };

      await pinned.teardown();

      expect(atStop).toEqual({ pooled: 0, clientOpen: false });
      expect(pool.totalCount).toBe(0);
      expect(pool.idleCount).toBe(0);
    },
    CONTAINER_BOOT_TIMEOUT_MS,
  );

  it(
    "survives a container that goes away with the dedicated client still open",
    async () => {
      const pinned = await startTestDb({ migrate: false });
      await pinned.client.query("select 1");

      // An `error` event on a `pg.Client` with no listener is an uncaught exception,
      // which would take the whole Vitest worker down.
      await pinned.container.stop();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const refusal = await pinned.client.query("select 1").then(
        () => "no error",
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
      expect(refusal).not.toBe("no error");

      // Drains the pool and the client so no socket or idle timer outlives the file.
      await pinned.teardown().catch(() => undefined);
    },
    CONTAINER_BOOT_TIMEOUT_MS,
  );
});

describe("startTestDb image-pull failure reporting (issue #74)", () => {
  // Both cases take the file's boot budget, because the Testcontainers
  // infrastructure step before the dial can pull the Ryuk reaper on a cold host.
  it(
    "reports the registry failure and the image instead of Docker's opaque error",
    async () => {
      const failure = await captureStartFailure({ image: UNPULLABLE_IMAGE });

      expect(failure).toBeInstanceOf(Error);
      expect(failure?.message).toContain("Could not PULL the test Postgres image");
      expect(failure?.message).toContain(UNPULLABLE_IMAGE);
      expect(failure?.message).toContain("QCMS_TEST_POSTGRES_IMAGE");
      expect(failure?.message).toMatch(
        new RegExp(`cause:.+${escapeForRegExp(UNPULLABLE_REGISTRY)}`, "s"),
      );
      expect(failure?.cause).toBeDefined();
      expect(failure?.message).not.toContain("Ryuk");
    },
    CONTAINER_BOOT_TIMEOUT_MS,
  );

  it(
    "fails the next attempt immediately rather than waiting on the registry again",
    async () => {
      // Primed here, so this case does not depend on the one above having completed.
      const first = await captureStartFailure({ image: UNPULLABLE_IMAGE_FOR_REPLAY });
      expect(first?.message).toContain("Could not PULL the test Postgres image");
      expect(first?.message).not.toContain("not retried");

      const failure = await captureStartFailure({ image: UNPULLABLE_IMAGE_FOR_REPLAY });

      expect(failure?.message).toContain("not retried");
      expect(failure?.message).toContain(UNPULLABLE_IMAGE_FOR_REPLAY);
    },
    CONTAINER_BOOT_TIMEOUT_MS,
  );
});

/**
 * The boot is injected rather than forced: Testcontainers reuses any reaper already
 * running, so an unreachable `RYUK_CONTAINER_IMAGE` fails only sometimes.
 */
describe("startTestDb infrastructure failure reporting (issue #150)", () => {
  it("blames the Ryuk reaper, not the configured Postgres image", async () => {
    const failure = await captureStartFailure({
      bootInfrastructure: () => Promise.reject(new Error(HUB_TIMEOUT_MESSAGE)),
    });

    expect(failure).toBeInstanceOf(Error);
    expect(failure?.message).toContain("Ryuk reaper");
    expect(failure?.message).toContain("TESTCONTAINERS_RYUK_DISABLED");
    expect(failure?.message).toContain("RYUK_CONTAINER_IMAGE");
    expect(failure?.message).not.toContain("Could not PULL the test Postgres image");
    expect(failure?.message).not.toContain("source: TEST_POSTGRES_IMAGE");
    expect(failure?.message).not.toMatch(/fix:.*QCMS_TEST_POSTGRES_IMAGE/);
    expect(failure?.message).toContain("registry-1.docker.io");
    expect(failure?.cause).toBeDefined();
  }, 60_000);

  it(
    "classifies a non-registry reaper failure as a start failure",
    async () => {
      const failure = await captureStartFailure({
        bootInfrastructure: () => Promise.reject(new Error("Failed to connect to Reaper")),
      });

      expect(failure?.message).toContain("Could not START the Testcontainers Ryuk reaper");
      expect(failure?.message).not.toContain("Could not PULL");
    },
    CONTAINER_BOOT_TIMEOUT_MS,
  );
});

/**
 * A dead daemon socket produces the same words as registry trouble. Injected rather
 * than forced: a test may not stop the daemon under a running suite.
 */
describe("startTestDb daemon-connectivity failure reporting (issue #171)", () => {
  const DAEMON_DOWN_MESSAGES = [
    "connect ECONNREFUSED /var/run/docker.sock",
    "connect ENOENT /var/run/docker.sock",
    "Could not find a working container runtime strategy",
    "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?",
  ];

  it.each(DAEMON_DOWN_MESSAGES)(
    "reports %s as daemon connectivity, not as an image pull",
    async (message) => {
      const failure = await captureStartFailure({
        bootInfrastructure: () => Promise.reject(new Error(message)),
      });

      expect(failure?.message).toContain("Could not REACH the Docker daemon");
      expect(failure?.message).not.toContain("Could not PULL");
      expect(failure?.message).not.toContain(TEST_POSTGRES_IMAGE);
      expect(failure?.message).not.toMatch(/fix:.*(QCMS_TEST_POSTGRES_IMAGE|RYUK_CONTAINER_IMAGE)/);
      expect(failure?.message).toContain(message);
      expect(failure?.cause).toBeDefined();
    },
    CONTAINER_BOOT_TIMEOUT_MS,
  );

  it(
    "keeps a genuine registry failure classified as a pull",
    async () => {
      const failure = await captureStartFailure({
        bootInfrastructure: () => Promise.reject(new Error(HUB_TIMEOUT_MESSAGE)),
      });

      expect(failure?.message).toContain("Could not PULL the Testcontainers Ryuk reaper image");
      expect(failure?.message).not.toContain("Could not REACH the Docker daemon");
    },
    CONTAINER_BOOT_TIMEOUT_MS,
  );

  it(
    "does not poison the image cache when the daemon was the problem",
    async () => {
      // `bootInfrastructure` rejects before any pull, so this reference is only ever a
      // cache key and is never dialled.
      const image = "localhost:1/qcms-daemon-probe:16-alpine";
      const daemonFailure = await captureStartFailure({
        image,
        bootInfrastructure: () =>
          Promise.reject(new Error("connect ECONNREFUSED /var/run/docker.sock")),
      });
      expect(daemonFailure?.message).toContain("Could not REACH the Docker daemon");

      const second = await captureStartFailure({
        image,
        bootInfrastructure: () =>
          Promise.reject(new Error("connect ECONNREFUSED /var/run/docker.sock")),
      });
      expect(second?.message).not.toContain("not retried");
    },
    CONTAINER_BOOT_TIMEOUT_MS,
  );
});

/**
 * The failure is simulated with an unservable registry, because a test that produced
 * real host contention would be a test that caused it.
 */
describe("startTestDb host snapshot on a failed boot (issue #812)", () => {
  const SNAPSHOT_PROBE_IMAGE = `${UNPULLABLE_REGISTRY}/qcms-host-snapshot-probe:16-alpine`;

  const SNAPSHOT_REPLAY_IMAGE = `${UNPULLABLE_REGISTRY}/qcms-host-snapshot-replay:16-alpine`;

  it(
    "says what the host was doing beside the failure it is already reporting",
    async () => {
      const failure = await captureStartFailure({ image: SNAPSHOT_PROBE_IMAGE });

      expect(failure?.message).toContain(HOST_SNAPSHOT_PREFIX);
      // A busy daemon can take seconds to answer `docker ps`, so the census alone
      // would be flaky under exactly the load this line exists to report.
      expect(failure?.message).toMatch(
        /docker (?:\d+ running, \d+ Testcontainers across \d+ session|unknown \(the daemon did not answer the census within \d+ms\))/,
      );
      expect(failure?.message).toMatch(/load (?:\d+\.\d\d\/|unknown)/);
      expect(failure?.message).toContain("Could not PULL the test Postgres image");
      expect(failure?.message).toContain(SNAPSHOT_PROBE_IMAGE);
      const snapshot = failure?.message.split("\n").filter((line) => line.startsWith("  host:"));
      expect(snapshot).toHaveLength(1);
    },
    CONTAINER_BOOT_TIMEOUT_MS,
  );

  it(
    "takes a fresh reading on the fail-fast replay rather than repeating a stale one",
    async () => {
      // Primed here, so this case does not depend on the one above having completed.
      const first = await captureStartFailure({ image: SNAPSHOT_REPLAY_IMAGE });
      expect(first?.message).toContain("Could not PULL the test Postgres image");
      expect(first?.message).not.toContain("not retried");

      const failure = await captureStartFailure({ image: SNAPSHOT_REPLAY_IMAGE });

      expect(failure?.message).toContain("not retried");
      expect(failure?.message).toContain(HOST_SNAPSHOT_PREFIX);
      const snapshot = failure?.message.split("\n").filter((line) => line.startsWith("  host:"));
      expect(snapshot).toHaveLength(1);
    },
    CONTAINER_BOOT_TIMEOUT_MS,
  );
});
