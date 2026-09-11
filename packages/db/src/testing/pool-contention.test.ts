/**
 * The mid-suite annotation, against fake pools and fake errors (issue #812).
 *
 * No Docker and no database: what is under test is the decision - which rejections get a
 * host snapshot, which are left exactly as they arrived, and the guarantee that nothing
 * here can turn a failing query into a passing one.
 */

import { describe, expect, it, vi } from "vitest";

import {
  annotateWithHostSnapshot,
  instrumentPool,
  instrumentQueryable,
  isContentionShaped,
  MID_SUITE_CONTENTION_MARKERS,
} from "./pool-contention.js";

/** The snapshot stand-in, so no host is read and the assertion is a fixed string. */
const SNAPSHOT = "  host: load 18.42/12.10/9.03 over 8 cpus (2.30 per cpu)";
const line = () => SNAPSHOT;

/** The exact text issue #812 was filed for. */
const TERMINATED = "Connection terminated unexpectedly";

describe("isContentionShaped", () => {
  it("matches a dependency that went away or never answered", () => {
    for (const text of [
      TERMINATED,
      "Connection terminated due to connection timeout",
      "timeout exceeded when trying to connect",
      "server closed the connection unexpectedly",
      "terminating connection due to administrator command",
      "read ECONNRESET",
      "socket hang up",
      "Port 49153 not bound after 210000ms",
    ]) {
      expect(isContentionShaped(text), text).toBe(true);
    }
  });

  it("does not match a database that answered and said no", () => {
    // The line that keeps the annotation honest. A constraint violation is unambiguously
    // the code's problem, and a host snapshot beside it is noise that teaches a reader to
    // skip the snapshot in the case where it matters.
    for (const text of [
      'null value in column "question_id" violates not-null constraint',
      'relation "responses" does not exist',
      "duplicate key value violates unique constraint",
      "expected 2 rows, got 1",
    ]) {
      expect(isContentionShaped(text), text).toBe(false);
    }
  });

  it("keeps every marker anchored to a wording rather than to a substring of a word", () => {
    // Guards a later edit that widens a pattern into something a query error can match.
    expect(MID_SUITE_CONTENTION_MARKERS.length).toBeGreaterThan(0);
    for (const marker of MID_SUITE_CONTENTION_MARKERS) {
      expect(marker.test("SELECT 1"), String(marker)).toBe(false);
    }
  });
});

describe("annotateWithHostSnapshot", () => {
  it("appends the snapshot to a contention-shaped error", () => {
    const error = new Error(TERMINATED);

    annotateWithHostSnapshot(error, line);

    expect(error.message).toBe(`${TERMINATED}\n${SNAPSHOT}`);
  });

  it("keeps the error object, so a caller's code and instanceof still hold", () => {
    // Mutating rather than wrapping is deliberate: pg errors carry `code` and `severity`
    // that callers read, and a wrapper would either lose them or have to forge them.
    const error = Object.assign(new Error(TERMINATED), { code: "57P01", severity: "FATAL" });

    annotateWithHostSnapshot(error, line);

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("57P01");
    expect(error.severity).toBe("FATAL");
  });

  it("annotates once, however many layers rethrow the same error", () => {
    const error = new Error(TERMINATED);

    annotateWithHostSnapshot(error, line);
    annotateWithHostSnapshot(error, line);
    annotateWithHostSnapshot(error, line);

    expect(error.message.split("host:")).toHaveLength(2);
  });

  it("leaves an ordinary query failure untouched", () => {
    const error = new Error("duplicate key value violates unique constraint");

    annotateWithHostSnapshot(error, line);

    expect(error.message).toBe("duplicate key value violates unique constraint");
  });

  it("ignores a rejection that is not an Error at all", () => {
    expect(() => {
      annotateWithHostSnapshot("just a string", line);
    }).not.toThrow();
  });
});

/** A `pg.Pool` stand-in: enough surface for the wrapper, none of the driver. */
function fakePool(behaviour: {
  query?: () => unknown;
  connect?: () => unknown;
}): Record<string, unknown> {
  return {
    query: behaviour.query ?? (() => Promise.resolve({ rows: [] })),
    connect: behaviour.connect ?? (() => Promise.resolve({ query: () => Promise.resolve({}) })),
  };
}

describe("instrumentQueryable", () => {
  it("annotates a contention-shaped rejection", async () => {
    const queryable = fakePool({ query: () => Promise.reject(new Error(TERMINATED)) });
    instrumentQueryable(queryable, line);

    await expect((queryable.query as () => Promise<unknown>)()).rejects.toThrow(SNAPSHOT);
  });

  it("passes a successful query straight through", async () => {
    const rows = [{ id: 1 }];
    const queryable = fakePool({ query: () => Promise.resolve({ rows }) });
    instrumentQueryable(queryable, line);

    await expect((queryable.query as () => Promise<{ rows: unknown }>)()).resolves.toStrictEqual({
      rows,
    });
  });

  it("still fails the query it annotated", async () => {
    // The whole rule of this module in one assertion: it adds a line, it never rescues.
    const queryable = fakePool({ query: () => Promise.reject(new Error(TERMINATED)) });
    instrumentQueryable(queryable, line);

    await expect((queryable.query as () => Promise<unknown>)()).rejects.toBeInstanceOf(Error);
  });

  it("leaves the callback overload's return value alone", () => {
    // `query(text, values, callback)` returns `undefined`, not a promise. Wrapping what is
    // not thenable would change what a caller receives.
    const queryable = fakePool({ query: () => undefined });
    instrumentQueryable(queryable, line);

    expect((queryable.query as () => unknown)()).toBeUndefined();
  });

  it("wraps once, so a second call adds no second layer", () => {
    const original = vi.fn(() => Promise.resolve({ rows: [] }));
    const queryable = fakePool({ query: original });

    instrumentQueryable(queryable, line);
    const afterFirst = queryable.query;
    instrumentQueryable(queryable, line);

    expect(queryable.query).toBe(afterFirst);
  });
});

describe("instrumentPool", () => {
  it("annotates a rejection from the pool's own query", async () => {
    const pool = fakePool({ query: () => Promise.reject(new Error(TERMINATED)) });
    instrumentPool(pool, line);

    await expect((pool.query as () => Promise<unknown>)()).rejects.toThrow(SNAPSHOT);
  });

  it("annotates a checkout that never completes", async () => {
    const pool = fakePool({
      connect: () => Promise.reject(new Error("timeout exceeded when trying to connect")),
    });
    instrumentPool(pool, line);

    await expect((pool.connect as () => Promise<unknown>)()).rejects.toThrow(SNAPSHOT);
  });

  it("annotates a query issued on a client the pool handed out", async () => {
    // Drizzle runs every `db.transaction()` on a checked-out client rather than on the
    // pool, so a pool wrapper that stopped at `query` would miss most of the traffic the
    // integration suites generate.
    const client = { query: () => Promise.reject(new Error(TERMINATED)) };
    const pool = fakePool({ connect: () => Promise.resolve(client) });
    instrumentPool(pool, line);

    const checkedOut = await (pool.connect as () => Promise<typeof client>)();

    await expect(checkedOut.query()).rejects.toThrow(SNAPSHOT);
  });

  it("instruments a reused client only once", async () => {
    const client = { query: () => Promise.resolve({ rows: [] }) };
    const pool = fakePool({ connect: () => Promise.resolve(client) });
    instrumentPool(pool, line);

    const checkout = pool.connect as () => Promise<typeof client>;
    await checkout();
    const afterFirst = client.query;
    await checkout();

    expect(client.query).toBe(afterFirst);
  });
});
