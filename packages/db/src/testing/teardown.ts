import { isContentionShaped } from "./pool-contention.js";

/**
 * A `pg.Pool` or `pg.Client`: an object with an `end()` the harness must await.
 *
 * `object &` is load-bearing: `register` stamps a symbol on what it is handed, so a
 * non-object must be refused by the compiler rather than failing at the first write.
 */
export type DrainableConnection = object & {
  end(): Promise<void> | void;
};

/**
 * The container surface this module needs. Structural because naming a Testcontainers type
 * here would put the optional peers back on the emitted declaration surface.
 */
export interface StoppableContainer {
  stop(): Promise<unknown>;
}

interface ErrorEmitting {
  on(event: "error", listener: (error: unknown) => void): unknown;
}

interface ReleasableClient {
  release(...args: unknown[]): unknown;
}

interface Connectable {
  connect(...args: unknown[]): unknown;
}

/** Message of the `AggregateError` a failed drain raises, so a caller can pin it. */
export const DRAIN_FAILED_MESSAGE =
  "@roonga/qcms-db/testing: teardown could not drain every connection";

/**
 * One line naming every connection a drain could not close. Needed where no test is watching
 * and the warning is the only report: `AggregateError` flattens to
 * {@link DRAIN_FAILED_MESSAGE} alone, which names no connection.
 */
export function describeDrainFailure(failure: unknown): string {
  if (!(failure instanceof AggregateError)) {
    return failure instanceof Error ? failure.message : String(failure);
  }
  const detail = failure.errors
    .map((error: unknown) => {
      const head = error instanceof Error ? error.message : String(error);
      const cause: unknown = error instanceof Error ? error.cause : undefined;
      return cause instanceof Error ? `${head}: ${cause.message}` : head;
    })
    .join("; ");
  return detail.length > 0 ? `${failure.message}: ${detail}` : failure.message;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function isReleasable(value: unknown): value is ReleasableClient {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { release?: unknown }).release === "function"
  );
}

function isConnectable(value: unknown): value is Connectable {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { connect?: unknown }).connect === "function"
  );
}

const GUARDED = Symbol.for("qcms.db.testing.error-guarded");
const TRACKED = Symbol.for("qcms.db.testing.checkouts-tracked");

function claim(target: object, marker: symbol): boolean {
  const marked = target as Record<symbol, true | undefined>;
  if (marked[marker] === true) return false;
  marked[marker] = true;
  return true;
}

/**
 * Attach the `error` listener a connection needs: an `error` event with no listener is an
 * uncaught exception, so a dying connection would take the worker down. A connection death
 * is ignored; anything else is re-raised.
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
        : new Error(`@roonga/qcms-db/testing: non-connection error on the ${label}: ${message}`);
    }, 0);
  });
}

/**
 * Returns the function that releases whatever is still checked out.
 *
 * A pool re-assigns `release` on every checkout, so the wrapper is installed per checkout
 * rather than once per client. The callback overload of `connect` is left alone: wrapping it
 * would change what the caller receives.
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
   * drains it before the container stops. Returns its argument.
   */
  register<T extends DrainableConnection>(connection: T, label: string): T;
  /** Drains every registered connection, then stops the container. Idempotent. */
  run(): Promise<void>;
}

/**
 * Build the teardown for one started container. Drains in reverse registration order: a later
 * connection may depend on an earlier one, so the dependant closes first.
 */
export function createHarnessTeardown(container: StoppableContainer): HarnessTeardown {
  const registrations: Registration[] = [];
  const known = new Set<DrainableConnection>();
  let ran = false;

  return {
    register<T extends DrainableConnection>(connection: T, label: string): T {
      // A second entry would call `end()` on a pool with a client still out, which never
      // settles: only the first registration carries the checkout tracking.
      if (known.has(connection)) return connection;
      known.add(connection);
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
        // A client a test left checked out would keep `pool.end()` pending forever.
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
