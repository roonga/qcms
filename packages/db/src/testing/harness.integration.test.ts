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
 */

import type { Readable } from "node:stream";

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
  const logs = (await testDb.container.logs()) as Readable;
  logs.on("data", (chunk: Buffer | string) => {
    serverLog += chunk.toString();
  });
  logs.on("error", () => undefined);
}, BOOT_TIMEOUT);

afterAll(async () => {
  await testDb.teardown();
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
