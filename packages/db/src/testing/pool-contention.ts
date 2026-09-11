/**
 * Attaching the host snapshot to a connection that died mid-suite (issue #812).
 *
 * ## The failure this exists for
 *
 * Issue #746 closed the boot half of the contention family by giving the container a
 * budget that survives a busy machine. The second half arrives later and looks nothing
 * like it: a suite is already running, its container is up, and a pooled query rejects
 * with `Connection terminated unexpectedly` from `pg`. The file it reds is one the
 * branch never touched, it is green in isolation three times over, and the message
 * contains no word about Docker, the host, or the ten other `postgres:16-alpine` boots
 * that were queued on the same daemon when the backend went away. A timeout on a busy
 * host and a genuine defect read identically, so the only way to tell them apart was to
 * re-run the suite - which is a full cycle spent answering a question the harness was
 * in a position to answer for free.
 *
 * So it answers it. The error keeps its identity, its `code`, its stack and its place in
 * the run; one line is appended to its message saying what the machine looked like.
 *
 * ## The rules this instrumentation holds to
 *
 * - **It never swallows.** Every wrapper rethrows the original error object. Nothing
 *   here retries, reconnects, downgrades a failure, or makes a red run green.
 * - **It never fires on a healthy path.** A query that resolves is untouched, and a
 *   rejection whose text matches none of {@link MID_SUITE_CONTENTION_MARKERS} is
 *   rethrown exactly as it arrived. A `NOT NULL` violation gets no host snapshot: the
 *   note would be noise in the one case where the failure is unambiguously the code's.
 * - **It annotates once.** One dropped backend rejects every query in flight and the
 *   same error object can be rethrown through several layers, so the marker symbol is
 *   what stops a message growing a snapshot per hop.
 * - **It costs one reading per five seconds.** {@link hostSnapshotLine} caches, which
 *   matters here more than anywhere: a pool whose backend vanished can reject hundreds
 *   of queries in a second, and a `docker ps` per rejection would make the harness a
 *   load source on the machine it is measuring.
 */

import { hostSnapshotLine } from "./host-snapshot.js";

/**
 * Error texts that mean "something underneath this run went away or never answered",
 * as opposed to "the database rejected what this run asked for".
 *
 * Every entry is a shape produced by a connection dying, timing out, or never binding -
 * never a shape that only a schema or query defect produces. That line is what keeps the
 * annotation honest: a match says the failure has the SHAPE contention produces, which
 * is a claim about the failure and deliberately not the claim that contention caused it.
 * A container the suite itself stopped too early drops connections the same way.
 */
export const MID_SUITE_CONTENTION_MARKERS: readonly RegExp[] = [
  // node-postgres, when the backend disappears under an in-flight query. The exact
  // wording issue #812 was filed for.
  /connection terminated unexpectedly/i,
  // node-postgres' own connect and acquire budgets.
  /connection terminated due to connection timeout/i,
  /timeout exceeded when trying to connect/i,
  // libpq's wording for the same event, which surfaces through some drivers and tools.
  /server closed the connection unexpectedly/i,
  // Postgres 57P01: the server was told to shut down while this connection was open.
  // Issue #888's teardown race lands here; the snapshot says whether the machine was
  // also loaded, which is the question that separates those two stories.
  /terminating connection due to administrator command/i,
  // Socket-level endings of the same event.
  /ECONNRESET|EPIPE|socket hang up/i,
  // Testcontainers' port-bind ceiling. Usually raised from `.start()`, where the harness
  // annotates it directly, but it also reaches a caller through a lazily started
  // container, and the text names a port rather than the contention behind it.
  /not bound after \d+ms/i,
];

/** True when `text` has the shape of a dependency that went away rather than said no. */
export function isContentionShaped(text: string): boolean {
  return MID_SUITE_CONTENTION_MARKERS.some((marker) => marker.test(text));
}

/**
 * Marks an error whose message already carries a snapshot.
 *
 * `Symbol.for` rather than a module-local symbol: the harness can be loaded more than
 * once in a worker (source and built copies both resolve in this workspace), and two
 * registries would each annotate the same error.
 */
const ANNOTATED = Symbol.for("qcms.db.testing.host-snapshot-annotated");

/** An error we may have already annotated. */
type Annotatable = Error & { [ANNOTATED]?: true };

/**
 * Append the host snapshot to `error`, when its shape warrants one.
 *
 * Mutates the message rather than wrapping the error in a new one, and that is the
 * deliberate choice: callers and other harness code read `error.code`, `error.severity`
 * and the `instanceof` of pg's own error classes, and a wrapper would either lose those
 * or have to forge them. The error that reaches Vitest is the error pg raised.
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

/** Anything that hands out a pooled client. */
interface Connectable {
  connect: (...args: unknown[]) => unknown;
}

/** Marks an object whose methods are already wrapped. */
const INSTRUMENTED = Symbol.for("qcms.db.testing.contention-instrumented");

/** True when `target` has already been wrapped, and marks it when it has not. */
function claim(target: object): boolean {
  const marked = target as { [INSTRUMENTED]?: true };
  if (marked[INSTRUMENTED] === true) return false;
  marked[INSTRUMENTED] = true;
  return true;
}

/** True for a value that can be awaited. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Rethrow `promise`'s rejection, annotated.
 *
 * `Promise.resolve` first, because pg returns its own promise implementation in some
 * paths and this only needs the thenable contract.
 */
async function annotatedRejection<T>(promise: PromiseLike<T>, line: () => string): Promise<T> {
  try {
    return await promise;
  } catch (cause) {
    annotateWithHostSnapshot(cause, line);
    throw cause;
  }
}

/**
 * Replace `target.query` with a wrapper that annotates a contention-shaped rejection.
 *
 * `query` has a callback overload as well as a promise one, and the callback form does
 * not return a thenable. That form is left alone rather than half-instrumented: nothing
 * in this workspace uses it, and a wrapper that guessed wrong about which overload it
 * was in could change what a caller receives. Returning the original value untouched
 * when it is not thenable is the whole of that guard.
 */
function wrapQuery(target: object, line: () => string): void {
  const queryable = target as unknown as Queryable;
  const original = queryable.query.bind(queryable);
  queryable.query = (...args: unknown[]): unknown => {
    const result = original(...args);
    return isThenable(result) ? annotatedRejection(result, line) : result;
  };
}

/** Replace `pool.connect` so both the checkout and the client it hands back are covered. */
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
 * Wrap `target.query`, once.
 *
 * Used for the dedicated `pg.Client` and for each client a pool checks out. A pool
 * reuses its clients, so the marker is what makes the second checkout a no-op rather
 * than a second layer of wrapping.
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
 * Wrap a pool's `query` and `connect` so both halves of Drizzle's traffic are covered.
 *
 * Drizzle's node-postgres driver issues a plain statement on the pool itself and a
 * transaction's statements on a client it checks out, so instrumenting only `query`
 * would leave every `db.transaction()` unannotated - which is most of what the
 * integration suites do.
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
