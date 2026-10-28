/**
 * No Docker and no Postgres: the refusal comes from a loopback port this file opens
 * and closes. `teardown.ts` lets the guard ignore anything the shared contention
 * markers match, so a shape that reached only that channel would be a failure no
 * test could see.
 */

import { createServer } from "node:net";

import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";

import { instrumentPool, instrumentQueryable } from "./pool-contention.js";
import { createHarnessTeardown, type StoppableContainer } from "./teardown.js";

/** The snapshot stand-in, so no host is read. */
const SNAPSHOT = "  host: load 18.42/12.10/9.03 over 8 cpus (2.30 per cpu)";
const line = () => SNAPSHOT;

const NO_CONTAINER: StoppableContainer = { stop: () => Promise.resolve() };

/**
 * Bound on port 0 so the kernel picks a free one, then closed: that is the only way
 * to be sure the refusal is a refusal rather than a stranger's service answering.
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

function refusedConnection(port: number): pg.ClientConfig {
  return { host: "127.0.0.1", port, user: "nobody", password: "nothing", database: "nowhere" };
}

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
    // The same order `startTestDb` uses: registered, which attaches the guard, before
    // the connect that can fail.
    teardown.register(client, "dedicated client");
    instrumentQueryable(client, line);
    // A second listener on the channel the guard listens to, so an arrival there is
    // visible even though the guard ignores it.
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
