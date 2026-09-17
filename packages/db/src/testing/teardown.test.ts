/**
 * The ordering contract of the harness teardown (issue #888).
 *
 * Every assertion here is about order and completeness rather than about Postgres, so this
 * file runs on fakes and needs no Docker. The real-container half of the pin lives in
 * `harness.integration.test.ts`, where a pooled client is genuinely checked out against a
 * genuinely running server.
 */

import { describe, expect, it, vi } from "vitest";

import {
  createHarnessTeardown,
  describeDrainFailure,
  DRAIN_FAILED_MESSAGE,
  guardConnectionErrors,
} from "./teardown.js";

/** A recorder every fake in this file appends to, so one array holds the whole order. */
type Journal = string[];

/** The `pg.Client`-shaped fake: an `end()` and an `error` event. */
interface FakeClient {
  end(): Promise<void>;
  on(event: "error", listener: (error: unknown) => void): void;
  /** Deliver an `error` event to whatever the guard attached. */
  emitError(error: unknown): void;
  /** How many `error` listeners are attached, so double-guarding is visible. */
  listenerCount(): number;
  ended(): boolean;
}

function fakeClient(journal: Journal, label: string, failOnEnd = false): FakeClient {
  const listeners: ((error: unknown) => void)[] = [];
  let closed = false;
  return {
    async end() {
      if (failOnEnd) throw new Error(`${label} refused to close`);
      await Promise.resolve();
      closed = true;
      journal.push(`end:${label}`);
    },
    on(event, listener) {
      expect(event).toBe("error");
      listeners.push(listener);
    },
    emitError(error) {
      for (const listener of [...listeners]) listener(error);
    },
    listenerCount: () => listeners.length,
    ended: () => closed,
  };
}

/** The `pg.Pool`-shaped fake: checkouts that must come back before `end()` can settle. */
interface FakePool {
  end(): Promise<void>;
  on(event: "error", listener: (error: unknown) => void): void;
  connect(): Promise<{ release(): void }>;
  checkedOutCount(): number;
  ended(): boolean;
}

function fakePool(journal: Journal, label: string): FakePool {
  const checkedOut = new Set<{ release(): void }>();
  let closed = false;
  return {
    async end() {
      // The behaviour that makes this issue's third shape fatal: pg ends its idle clients
      // and then waits for the checked-out one, so a leaked checkout never lets end settle.
      if (checkedOut.size > 0) await new Promise(() => undefined);
      await Promise.resolve();
      closed = true;
      journal.push(`end:${label}`);
    },
    on(event) {
      expect(event).toBe("error");
    },
    connect() {
      const client = {
        release() {
          checkedOut.delete(client);
          journal.push(`release:${label}`);
        },
      };
      checkedOut.add(client);
      return Promise.resolve(client);
    },
    checkedOutCount: () => checkedOut.size,
    ended: () => closed,
  };
}

/** A started-container fake that records when it was asked to stop. */
interface FakeContainer {
  stop(): Promise<unknown>;
  stops(): number;
}

function fakeContainer(journal: Journal, probe: () => string = () => ""): FakeContainer {
  let count = 0;
  return {
    async stop() {
      await Promise.resolve();
      count += 1;
      journal.push(`stop${probe()}`);
      return undefined;
    },
    stops: () => count,
  };
}

/** The `AggregateError` a failed drain raises, or undefined when `run()` resolved. */
async function captureRunFailure(run: () => Promise<void>): Promise<unknown> {
  try {
    await run();
    return undefined;
  } catch (error: unknown) {
    return error;
  }
}

describe("createHarnessTeardown drain order", () => {
  it("closes every registered connection before it stops the container", async () => {
    const journal: Journal = [];
    const container = fakeContainer(journal);
    const teardown = createHarnessTeardown(container);
    const client = teardown.register(fakeClient(journal, "client"), "client");
    const pool = teardown.register(fakePool(journal, "pool"), "pool");

    await teardown.run();

    expect(journal).toEqual(["end:pool", "end:client", "stop"]);
    expect(client.ended()).toBe(true);
    expect(pool.ended()).toBe(true);
  });

  it("drains newest first, so a connection opened through an earlier one closes first", async () => {
    const journal: Journal = [];
    const teardown = createHarnessTeardown(fakeContainer(journal));
    teardown.register(fakeClient(journal, "owner"), "owner");
    teardown.register(fakeClient(journal, "role"), "role");

    await teardown.run();

    expect(journal).toEqual(["end:role", "end:owner", "stop"]);
  });

  it("returns the connection it was handed, so a caller can register inline", () => {
    const journal: Journal = [];
    const teardown = createHarnessTeardown(fakeContainer(journal));
    const client = fakeClient(journal, "client");

    expect(teardown.register(client, "client")).toBe(client);
  });

  it("runs once: a second call neither re-drains nor re-stops", async () => {
    const journal: Journal = [];
    const container = fakeContainer(journal);
    const teardown = createHarnessTeardown(container);
    teardown.register(fakeClient(journal, "client"), "client");

    await teardown.run();
    await teardown.run();

    expect(journal).toEqual(["end:client", "stop"]);
    expect(container.stops()).toBe(1);
  });

  it("guards each connection once, however many times it is registered", () => {
    const journal: Journal = [];
    const teardown = createHarnessTeardown(fakeContainer(journal));
    const client = fakeClient(journal, "client");

    teardown.register(client, "client");
    teardown.register(client, "client again");

    expect(client.listenerCount()).toBe(1);
  });

  it("registers one connection once, so a repeat registration adds no second drain", async () => {
    const journal: Journal = [];
    const teardown = createHarnessTeardown(fakeContainer(journal));
    const pool = fakePool(journal, "pool");

    teardown.register(pool, "pool");
    teardown.register(pool, "pool again");
    await pool.connect();

    // A second entry would carry no checkout tracking of its own, so its `end()` would wait
    // on the held client forever and the container would never be stopped.
    await teardown.run();

    expect(journal).toEqual(["release:pool", "end:pool", "stop"]);
  });
});

describe("createHarnessTeardown and a client checked out at teardown time", () => {
  it("releases the held client, so the drain settles and the stop follows it", async () => {
    const journal: Journal = [];
    const teardown = createHarnessTeardown(fakeContainer(journal));
    const pool = teardown.register(fakePool(journal, "pool"), "pool");
    await pool.connect(); // checked out, and deliberately never released by the test

    expect(pool.checkedOutCount()).toBe(1);
    await teardown.run();

    // Release strictly before the pool closes, and the stop strictly after both. Without
    // the release, `end()` never settles, so the container stop is issued late and next to
    // a live connection, which is the third shape in issue #888.
    expect(journal).toEqual(["release:pool", "end:pool", "stop"]);
    expect(pool.checkedOutCount()).toBe(0);
  });

  it("never issues the stop while a connection is still live", async () => {
    const journal: Journal = [];
    const pool = fakePool(journal, "pool");
    const container = fakeContainer(
      journal,
      () => `(live=${String(pool.checkedOutCount())},closed=${String(pool.ended())})`,
    );
    const teardown = createHarnessTeardown(container);
    teardown.register(pool, "pool");
    await pool.connect();

    await teardown.run();

    expect(journal.at(-1)).toBe("stop(live=0,closed=true)");
  });

  it("leaves a callback-style checkout alone rather than half-wrapping it", async () => {
    const journal: Journal = [];
    const teardown = createHarnessTeardown(fakeContainer(journal));
    const handed: unknown[] = [];
    const callbackPool = {
      async end() {
        await Promise.resolve();
        journal.push("end:callback");
      },
      on(event: "error") {
        expect(event).toBe("error");
      },
      /** Returns nothing, as the callback overload of `pool.connect` does. */
      connect(callback: (client: unknown) => void) {
        callback({ release: () => journal.push("release:callback") });
      },
    };
    const pool = teardown.register(callbackPool, "callback pool");

    pool.connect((client: unknown) => handed.push(client));
    await teardown.run();

    // The callback still received its client untouched, and the drain still happened.
    expect(handed).toHaveLength(1);
    expect(journal).toEqual(["end:callback", "stop"]);
  });
});

describe("createHarnessTeardown when a drain fails", () => {
  it("stops the container anyway and reports which connection refused to close", async () => {
    const journal: Journal = [];
    const container = fakeContainer(journal);
    const teardown = createHarnessTeardown(container);
    teardown.register(fakeClient(journal, "bad", true), "bad client");
    teardown.register(fakeClient(journal, "good"), "good client");

    const failure = await captureRunFailure(() => teardown.run());

    // The container is stopped (no leak) and the good connection still drained.
    expect(container.stops()).toBe(1);
    expect(journal).toEqual(["end:good", "stop"]);
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError)) throw new Error("unreachable");
    expect(failure.message).toBe(DRAIN_FAILED_MESSAGE);
    expect(String(failure.errors[0])).toContain("bad client");

    // The one caller that cannot rethrow this - `startTestDb`'s failure path - logs a
    // string, so the detail has to survive being flattened into one.
    expect(describeDrainFailure(failure)).toContain("bad client did not close cleanly");
    expect(describeDrainFailure(failure)).toContain("bad refused to close");
  });
});

describe("describeDrainFailure", () => {
  it("names every connection and its cause, which AggregateError.message alone does not", () => {
    const aggregate = new AggregateError(
      [
        new Error("pool did not close cleanly", { cause: new Error("still had a client out") }),
        new Error("dedicated client did not close cleanly", { cause: new Error("socket gone") }),
      ],
      DRAIN_FAILED_MESSAGE,
    );

    // The bug this exists for: the aggregate's own message is the constant, nothing more.
    expect(aggregate.message).toBe(DRAIN_FAILED_MESSAGE);

    expect(describeDrainFailure(aggregate)).toBe(
      `${DRAIN_FAILED_MESSAGE}: pool did not close cleanly: still had a client out;` +
        " dedicated client did not close cleanly: socket gone",
    );
  });

  it("keeps an entry that carries no cause, rather than dropping it", () => {
    const aggregate = new AggregateError([new Error("pool did not close cleanly")], "top");

    expect(describeDrainFailure(aggregate)).toBe("top: pool did not close cleanly");
  });

  it("passes a plain error and a non-error through unchanged", () => {
    expect(describeDrainFailure(new Error("the container refused to stop"))).toBe(
      "the container refused to stop",
    );
    expect(describeDrainFailure("a thrown string")).toBe("a thrown string");
  });

  it("falls back to the aggregate's own message when it carries no errors", () => {
    expect(describeDrainFailure(new AggregateError([], DRAIN_FAILED_MESSAGE))).toBe(
      DRAIN_FAILED_MESSAGE,
    );
  });
});

describe("guardConnectionErrors", () => {
  it("observes a shutdown 57P01 instead of letting it become an uncaught exception", () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient([], "client");
      guardConnectionErrors(client, "dedicated client");

      client.emitError(
        Object.assign(new Error("terminating connection due to administrator command"), {
          code: "57P01",
        }),
      );

      // Nothing is scheduled, so nothing is rethrown: the 57P01 an idle connection raises
      // when its server is shut down has no test to fail and must not kill the worker.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    "Connection terminated unexpectedly",
    "socket hang up",
    "timeout exceeded when trying to connect",
  ])("also observes the other connection-death shape: %s", (message) => {
    vi.useFakeTimers();
    try {
      const client = fakeClient([], "client");
      guardConnectionErrors(client, "pool");
      client.emitError(new Error(message));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-raises anything that is not a connection dying, rather than dropping it", () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient([], "client");
      guardConnectionErrors(client, "pool");

      client.emitError(new Error('null value in column "id" violates not-null constraint'));

      // Scheduled on a fresh turn, where it reaches the runner as an unhandled error
      // rather than disappearing into a listener that returns undefined.
      expect(vi.getTimerCount()).toBe(1);
      expect(() => vi.runAllTimers()).toThrow("violates not-null constraint");
    } finally {
      vi.useRealTimers();
    }
  });

  it("wraps a non-Error value so the rethrow still names the connection", () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient([], "client");
      guardConnectionErrors(client, "dedicated client");

      client.emitError("something threw a string");

      expect(() => vi.runAllTimers()).toThrow("dedicated client");
    } finally {
      vi.useRealTimers();
    }
  });
});
