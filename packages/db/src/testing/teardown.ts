/**
 * One ordered teardown for every harness that boots a Testcontainers Postgres (issue #888).
 *
 * ## The failure this exists for
 *
 * Stopping a Postgres container sends the server a fast shutdown, and the server answers
 * every still-open backend with `57P01 terminating connection due to administrator
 * command`. Whether that is harmless or fatal depends entirely on which connection is
 * still open, and that was measured rather than assumed:
 *
 * - one **idle pooled** connection open across `container.stop()`: harmless. `pg.Pool`
 *   re-emits an idle client's error on the pool, and the harness has a pool listener, so
 *   the run survives.
 * - the **dedicated `pg.Client`** open across `container.stop()`: fatal. An `error` event
 *   on an `EventEmitter` with no listener is an uncaught exception, so it takes the whole
 *   Vitest worker down with a 57P01 nobody asked about, attributed to whichever file
 *   happened to be running. That is the shape issue #888 was filed for, and the shape the
 *   #896 lane hit while instrumenting the error path.
 * - a **checked-out** pooled client at teardown time: `pool.end()` never settles. pg ends
 *   idle clients and then waits for the checked-out one to come back, so a test file that
 *   leaks a checkout turns teardown into a hook timeout, and the container stop into
 *   something that happens later, elsewhere, next to live connections.
 *
 * ## What this module does about it
 *
 * It makes the order structural instead of incidental. Every connection opened against a
 * container is **registered** with that container's teardown, and {@link
 * HarnessTeardown.run} is the single function that drains them all and only then stops the
 * container. No caller re-derives the order, and no caller can get it wrong by writing its
 * own `afterAll` next to the harness's.
 *
 * ## The rules it holds to
 *
 * - **It never retries and never swallows a query failure.** A 57P01 that rejects an
 *   in-flight query still rejects it, still carries its `code`, and still reds its test -
 *   that path belongs to `pool-contention.ts` and is untouched here.
 * - **It does not hide a 57P01 either.** {@link guardConnectionErrors} exists because an
 *   `error` event on an idle connection has no test to fail and only two possible
 *   outcomes: crash the worker, or be observed. It observes. Anything that is *not* a
 *   connection dying is re-raised rather than dropped.
 * - **It stops the container even when a drain fails**, then reports the drain failure.
 *   A leaked container is a cost the next run pays; losing the reason is worse.
 */

import { isContentionShaped } from "./pool-contention.js";

/** A `pg.Pool` or `pg.Client`: something with an `end()` the harness must await. */
export interface DrainableConnection {
  end(): Promise<void> | void;
}

/**
 * The container surface this module needs. Structural for the same reason
 * `StartedTestPostgres` is (issue #407): naming a Testcontainers type here would put the
 * optional peers back on the emitted declaration surface.
 */
export interface StoppableContainer {
  stop(): Promise<unknown>;
}

/** An `EventEmitter`-shaped connection, which both `pg.Pool` and `pg.Client` are. */
interface ErrorEmitting {
  on(event: "error", listener: (error: unknown) => void): unknown;
}

/** A pooled client, as `pool.connect()` resolves it. */
interface ReleasableClient {
  release(...args: unknown[]): unknown;
}

/** Anything that hands out pooled clients. */
interface Connectable {
  connect(...args: unknown[]): unknown;
}

/** Message prefix for the aggregate a failed drain raises, so a test can pin it. */
export const DRAIN_FAILED_MESSAGE =
  "@roonga/qcms-db/testing: teardown could not drain every connection";

/** True for a value that can be awaited. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/** True when `value` exposes the `release` a pooled client carries. */
function isReleasable(value: unknown): value is ReleasableClient {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { release?: unknown }).release === "function"
  );
}

/** True when `value` exposes the `connect` a pool carries. */
function isConnectable(value: unknown): value is Connectable {
  return typeof (value as { connect?: unknown }).connect === "function";
}

/** Marks a connection whose `error` event is already guarded. */
const GUARDED = Symbol.for("qcms.db.testing.error-guarded");

/** Marks a pool whose checkouts are already tracked. */
const TRACKED = Symbol.for("qcms.db.testing.checkouts-tracked");

/** True when `target` carries `marker`, and stamps it when it does not. */
function claim(target: object, marker: symbol): boolean {
  const marked = target as Record<symbol, true | undefined>;
  if (marked[marker] === true) return false;
  marked[marker] = true;
  return true;
}

/**
 * Attach the `error` listener that keeps a dying connection from killing the worker.
 *
 * This is the half of issue #888 that is not about ordering. Correct ordering means no
 * connection is open when the container stops, but "no connection is open" is a property of
 * the run, not of the process: a `startTestDb` that throws after `client.connect()`, an
 * external `docker stop`, a reaper on a machine the run does not own, all end a live
 * connection without asking. Without a listener each of those is an uncaught 57P01 and a
 * dead worker; with one they are what they are, which is nothing a test can act on.
 *
 * **A connection death is ignored; anything else is re-raised.** The shapes ignored here
 * are exactly {@link isContentionShaped} - a backend that went away, timed out, or was
 * shut down. Any other `error` event is rethrown on a fresh turn of the event loop, so it
 * reaches the runner instead of disappearing into a listener that returns `undefined`.
 * Nothing here makes a failing query pass: an error that rejects a query is delivered to
 * that query's caller by pg and never reaches this listener at all.
 */
export function guardConnectionErrors(connection: object, label: string): void {
  if (!claim(connection, GUARDED)) return;
  const emitter = connection as unknown as ErrorEmitting;
  emitter.on("error", (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (isContentionShaped(message)) return;
    setTimeout(() => {
      throw error instanceof Error
        ? error
        : new Error(
            `@roonga/qcms-db/testing: non-connection error on the test ${label}: ${message}`,
          );
    }, 0);
  });
}

/**
 * Track what a pool hands out, so teardown can hand it back.
 *
 * Returns the function that releases whatever is still checked out. A pool reuses its
 * client objects and re-assigns `release` on every checkout, so the wrapper is installed
 * per checkout (after pg has installed its own) rather than once per client.
 *
 * The callback overload of `connect` is left alone for the same reason
 * `pool-contention.ts` leaves the callback overload of `query` alone: nothing in this
 * workspace uses it, and a wrapper that guessed wrong about the overload would change what
 * the caller receives.
 */
function trackCheckouts(pool: object): () => void {
  const held = new Set<ReleasableClient>();
  if (!claim(pool, TRACKED)) return () => undefined;
  const connectable = pool as unknown as Connectable;
  const original = connectable.connect.bind(connectable);
  connectable.connect = (...args: unknown[]): unknown => {
    const result = original(...args);
    if (!isThenable(result)) return result;
    return Promise.resolve(result).then((client: unknown) => {
      if (!isReleasable(client)) return client;
      held.add(client);
      const originalRelease = client.release.bind(client);
      client.release = (...releaseArgs: unknown[]): unknown => {
        held.delete(client);
        return originalRelease(...releaseArgs);
      };
      return client;
    });
  };
  return () => {
    for (const client of held) client.release();
    held.clear();
  };
}

/** One registered connection and the work its drain needs. */
interface Registration {
  readonly label: string;
  readonly connection: DrainableConnection;
  /** Hand back anything still checked out, so `end()` can settle. */
  readonly releaseHeld: () => void;
}

/** The single teardown a container's harness entry point runs. */
export interface HarnessTeardown {
  /**
   * Register a pool or client opened against this container, so {@link HarnessTeardown.run}
   * drains it before the container stops. Returns its argument, so a caller can write
   * `const pool = teardown.register(new Pool(...), "my pool")`.
   */
  register<T extends DrainableConnection>(connection: T, label: string): T;
  /** Drain every registered connection, newest first, then stop the container. Idempotent. */
  run(): Promise<void>;
}

/**
 * Build the teardown for one started container.
 *
 * Drains in reverse registration order: a connection opened later may depend on one opened
 * earlier (a role created through the owner client, say), and closing the dependant first
 * is the order that never surprises.
 */
export function createHarnessTeardown(container: StoppableContainer): HarnessTeardown {
  const registrations: Registration[] = [];
  let ran = false;

  return {
    register<T extends DrainableConnection>(connection: T, label: string): T {
      guardConnectionErrors(connection, label);
      const releaseHeld = isConnectable(connection) ? trackCheckouts(connection) : () => undefined;
      registrations.push({ label, connection, releaseHeld });
      return connection;
    },

    async run(): Promise<void> {
      if (ran) return;
      ran = true;
      const failures: Error[] = [];
      for (const registration of [...registrations].reverse()) {
        // A client a test left checked out would otherwise keep `pool.end()` pending
        // forever, so the container stop would be issued late, after the hook timeout,
        // with that client still live. Handing it back is what makes the drain finish.
        registration.releaseHeld();
        try {
          await registration.connection.end();
        } catch (cause) {
          failures.push(new Error(`${registration.label} did not close cleanly`, { cause }));
        }
      }
      // Unconditional: a drain failure must not leave the container running.
      await container.stop();
      if (failures.length > 0) throw new AggregateError(failures, DRAIN_FAILED_MESSAGE);
    },
  };
}
