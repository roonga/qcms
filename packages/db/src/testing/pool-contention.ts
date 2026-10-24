/**
 * Every wrapper here rethrows the original error object: nothing retries, swallows, or makes
 * a red run green.
 */

import { hostSnapshotLine } from "./host-snapshot.js";

/**
 * Error texts that mean a dependency went away rather than said no. Every entry must be a
 * shape only a connection dying, timing out or never binding produces.
 */
export const MID_SUITE_CONTENTION_MARKERS: readonly RegExp[] = [
  /connection terminated unexpectedly/i,
  /connection terminated due to connection timeout/i,
  /timeout exceeded when trying to connect/i,
  /server closed the connection unexpectedly/i,
  /terminating connection due to administrator command/i,
  /ECONNRESET|EPIPE|socket hang up/i,
  // Safe here because a refusal happens below the protocol: a database that is up and says
  // no never produces it.
  /ECONNREFUSED/i,
  /not bound after \d+ms/i,
];

/** True when `text` matches {@link MID_SUITE_CONTENTION_MARKERS}. */
export function isContentionShaped(text: string): boolean {
  return MID_SUITE_CONTENTION_MARKERS.some((marker) => marker.test(text));
}

/**
 * `Symbol.for` because the harness can be loaded twice in a worker (source and built
 * copies), and two module-local symbols would each annotate the same error.
 */
const ANNOTATED = Symbol.for("qcms.db.testing.host-snapshot-annotated");

type Annotatable = Error & { [ANNOTATED]?: true };

/**
 * Append the host snapshot to a contention-shaped `error`, once.
 *
 * Mutates the message rather than wrapping: callers read `error.code`, `error.severity` and
 * `instanceof` against pg's own error classes, which a wrapper would lose.
 */
export function annotateWithHostSnapshot(
  error: unknown,
  line: () => string = hostSnapshotLine,
): void {
  if (!(error instanceof Error)) return;
  const annotatable = error as Annotatable;
  if (annotatable[ANNOTATED] === true) return;
  if (!isContentionShaped(error.message)) return;
  annotatable[ANNOTATED] = true;
  error.message = `${error.message}\n${line()}`;
}

/** Anything with a `query` method: a `pg.Pool`, a `pg.Client`, or a pooled client. */
interface Queryable {
  query: (...args: unknown[]) => unknown;
}

interface Connectable {
  connect: (...args: unknown[]) => unknown;
}

const INSTRUMENTED = Symbol.for("qcms.db.testing.contention-instrumented");

function claim(target: object): boolean {
  const marked = target as { [INSTRUMENTED]?: true };
  if (marked[INSTRUMENTED] === true) return false;
  marked[INSTRUMENTED] = true;
  return true;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

async function annotatedRejection<T>(promise: PromiseLike<T>, line: () => string): Promise<T> {
  try {
    return await promise;
  } catch (cause) {
    annotateWithHostSnapshot(cause, line);
    throw cause;
  }
}

/**
 * The callback overload returns no thenable and is left untouched: wrapping it would change
 * what a caller receives.
 */
function wrapQuery(target: object, line: () => string): void {
  const queryable = target as unknown as Queryable;
  const original = queryable.query.bind(queryable);
  queryable.query = (...args: unknown[]): unknown => {
    const result = original(...args);
    return isThenable(result) ? annotatedRejection(result, line) : result;
  };
}

function wrapConnect(pool: object, line: () => string): void {
  const connectable = pool as unknown as Connectable;
  const original = connectable.connect.bind(connectable);
  connectable.connect = (...args: unknown[]): unknown => {
    const result = original(...args);
    if (!isThenable(result)) return result;
    return annotatedRejection(result, line).then((client) => {
      if (typeof client === "object" && client !== null) instrumentQueryable(client, line);
      return client;
    });
  };
}

/**
 * Wrap `target.query`, once. A pool reuses its clients, so the marker keeps a second
 * checkout from adding a second layer of wrapping.
 */
export function instrumentQueryable<T extends object>(
  target: T,
  line: () => string = hostSnapshotLine,
): T {
  if (!claim(target)) return target;
  wrapQuery(target, line);
  return target;
}

/**
 * Wrap a pool's `query` and `connect`. Drizzle runs plain statements on the pool and a
 * transaction's statements on a checked-out client, so `query` alone would leave every
 * `db.transaction()` unannotated.
 */
export function instrumentPool<T extends object>(
  pool: T,
  line: () => string = hostSnapshotLine,
): T {
  if (!claim(pool)) return pool;
  wrapQuery(pool, line);
  wrapConnect(pool, line);
  return pool;
}
