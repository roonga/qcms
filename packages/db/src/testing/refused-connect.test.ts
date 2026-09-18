/**
 * Which channel a refused connect comes out of (issues #939 and #888).
 *
 * Widening {@link MID_SUITE_CONTENTION_MARKERS} widens two things at once, because one
 * predicate serves both: `pool-contention.ts` uses it to decide which failures get a host
 * snapshot appended, and `teardown.ts` uses it to decide which `error` events the guard
 * may ignore. The first is additive and cannot hide anything. The second can: a shape that
 * reached ONLY that channel would be a failure no test could ever see, and the guard is
 * attached for a connection's whole life, not just inside a teardown window.
 *
 * `ECONNREFUSED` does not reach it. `pg` hands a connect failure to the caller that is
 * awaiting it and emits `error` only when no connection callback is waiting, so the
 * refusal fails the test that provoked it either way. That argument had to be rebuilt out
 * of `pg`'s internals by hand while #939 was reviewed, because nothing asserted it. This
 * file is that argument as a test, so the next widening of the marker list costs a read of
 * one file rather than a spelunk through a dependency.
 *
 * No Docker and no Postgres. The refusal comes from a loopback port this file opens and
 * immediately closes, so nothing is listening on it, and the number is whatever the kernel
 * handed out for a moment - never a QCMS allocation, and never written down (R8).
 */

import { createServer } from "node:net";

import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";

import { instrumentPool, instrumentQueryable } from "./pool-contention.js";
import { createHarnessTeardown, type StoppableContainer } from "./teardown.js";

/** The snapshot stand-in: this file is about the channel, not about reading a host. */
const SNAPSHOT = "  host: load 18.42/12.10/9.03 over 8 cpus (2.30 per cpu)";
const line = () => SNAPSHOT;

/** There is no container here; the teardown just needs something to stop. */
const NO_CONTAINER: StoppableContainer = { stop: () => Promise.resolve() };

/**
 * A loopback port with nothing behind it.
 *
 * Bound on port 0 so the kernel picks a free one, then closed before anything connects.
 * Asking for a free port and closing it is the only way to be sure the refusal is a
 * refusal rather than a stranger's service answering.
 */
async function closedLoopbackPort(): Promise<number> {
  const server = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("the loopback probe did not report an address"));
        return;
      }
      resolve(address.port);
    });
  });
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  return port;
}

/** Connection settings for a port nothing is listening on. */
function refusedConnection(port: number): pg.ClientConfig {
  return { host: "127.0.0.1", port, user: "nobody", password: "nothing", database: "nowhere" };
}

/** Everything opened by a test, so a failed assertion cannot leak a socket. */
let opened: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of opened) await close();
  opened = [];
});

describe("a refused connect, through the harness's own wiring", () => {
  it("rejects to the caller and never reaches the guard's ignore channel", async () => {
    const port = await closedLoopbackPort();
    const teardown = createHarnessTeardown(NO_CONTAINER);
    const client = new pg.Client(refusedConnection(port));
    // The same order `startTestDb` uses: registered (which attaches the guard) before the
    // connect that can fail, then instrumented.
    teardown.register(client, "dedicated client");
    instrumentQueryable(client, line);
    // A second listener on the channel the guard listens to. If the refusal arrived there,
    // this sees it; the guard would then have ignored the only copy of it.
    let reachedErrorEvent = false;
    client.on("error", () => {
      reachedErrorEvent = true;
    });
    opened.push(async () => {
      await client.end().catch(() => undefined);
    });

    await expect(client.connect()).rejects.toThrow(/ECONNREFUSED/);

    expect(reachedErrorEvent).toBe(false);
  });

  it("rejects a pooled query to the caller, with the snapshot appended", async () => {
    // The mid-suite half of the same story: a pool whose first checkout is refused fails
    // the query that asked for it, annotated, rather than going quiet (issue #939).
    const port = await closedLoopbackPort();
    const teardown = createHarnessTeardown(NO_CONTAINER);
    const pool = new pg.Pool(refusedConnection(port));
    teardown.register(pool, "pool");
    instrumentPool(pool, line);
    let reachedErrorEvent = false;
    pool.on("error", () => {
      reachedErrorEvent = true;
    });
    opened.push(async () => {
      await pool.end().catch(() => undefined);
    });

    const failure = await pool.query("select 1").catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("ECONNREFUSED");
    expect((failure as Error).message).toContain(SNAPSHOT);
    expect(reachedErrorEvent).toBe(false);
  });
});
