---
"@roonga/qcms-db": minor
---

Give the test harness one ordered teardown: every connection opened against a container is
registered with it, and the container stop is issued only once they are all closed (issue
#888).

Stopping a Postgres container answers every still-open backend with `57P01 terminating
connection due to administrator command`, and what that costs depends entirely on which
connection is still open. Measured against a real container: one idle **pooled** connection
is harmless, because `pg.Pool` re-emits an idle client's error on the pool and the harness
has a pool listener. The dedicated **`pg.Client`** is fatal, because it had no `error`
listener, and an `error` event on an emitter without one is an uncaught exception that takes
the whole Vitest worker down with a shutdown notice nobody asked about. A pooled client left
**checked out** is the third shape: `pg` ends its idle clients and then waits for the
checkout to come back, so `pool.end()` never settles, teardown runs to the hook timeout, and
the container stop lands late and beside live connections.

`TestDb` therefore gains `register(connection, label)`. A test file that opens its own pool
or client against `TestDb.connectionUri` hands it over instead of closing it in an `afterAll`
of its own, and `TestDb.teardown()` drains every registered connection (newest first,
releasing anything still checked out) before stopping the container. The previous
arrangement worked only because Vitest finishes a nested suite before its parent, which is a
convention rather than something the harness could hold a caller to. `startTestDb` now also
drains and stops on its own failure path, where a throwing migration used to leave a running
container and two open connections behind with no `TestDb` for any `afterAll` to tear down.

Nothing here retries or hides a failure. A 57P01 that rejects an in-flight query still
rejects it, still carries its `code`, and still reds its test; the new listener exists for
the idle-connection event that has no test to fail and only two possible outcomes, and it
re-raises anything that is not a connection dying.
