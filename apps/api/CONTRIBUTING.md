# qcms-api — slice conventions

This app is the Hono **composition root** (task 017). It owns the middleware,
mount flags, health/ready, config, and the in-process schedulers. Feature work
lands as **vertical slices** (018–026) that mount into this shell. This document
is the contract those slices conform to. It complements the root `CONTRIBUTING.md`
and `PROJECT_INSTRUCTIONS.md` (R1–R7, SEC-1…12) — where they overlap, those win.

## Folder layout

Each feature is a folder under `src/features/<area>/<slice>/` owning four files:

```
src/features/
  responses/
    start-session/
      route.ts     # the @hono/zod-openapi createRoute definition(s)
      schema.ts    # the Zod request/response schemas the route references
      handler.ts   # the fetch-pure handler(s)
      test.ts      # app.request()-based tests for this slice
```

`route.ts` exports a `SliceRegistrar` (`(group, deps) => void`) that calls
`group.openapi(route, handler)`. The server entry (`serve.ts`) collects
registrars into the surface buckets (`public` / `internal` / `admin`) it passes
to `createApp`. A slice never constructs its own app or reads the environment —
it receives everything through `deps`.

## Route-definition convention (mandatory)

Routes are declared with `@hono/zod-openapi`'s `createRoute` — **never** bare
`app.get(...)` in shipped code. This keeps Zod the single schema language and
makes the OpenAPI documents (027) generated artifacts that cannot drift.

- Request and response bodies are Zod schemas (`schema.ts`).
- Error responses use the shared envelope: spread `errorResponses(401, 409, ...)`
  from `src/openapi.ts` into the `responses` map.
- `/api/v1` scope intent (SEC-5) is annotated now even though the surface is
  reserved: spread `withScopes("responses:read", ...)` into the route. It rides
  in the generated document; it does not enforce anything at launch.

```ts
import { createRoute } from "@hono/zod-openapi";
import { errorResponses, withScopes } from "../../../openapi.js";

export const getStepRoute = createRoute({
  method: "get",
  path: "/sessions/{sessionId}/step",
  request: { params: SessionParams },
  responses: {
    200: { description: "The current step", content: { "application/json": { schema: StepResponse } } },
    ...errorResponses(401, 404),
  },
  ...withScopes("responses:read"),
});
```

## Handlers stay fetch-pure (R4)

Handlers use only Web APIs and injected collaborators — **no `node:*`**. Time is
`deps.clock`, logging is `deps.logger`, crypto is WebCrypto (`crypto.subtle`),
signing keys and config come from `deps.config`, flags from `deps.flags`. The
only place Node built-ins are allowed is `serve.ts` (the process boundary) and
test files. This is what lets the same handler run on Node or an edge runtime.

## Transaction ownership

The **slice owns the transaction boundary**, never the query helpers (R3, R5).
Query helpers from `@qcms/db` take an `Executor` (a Drizzle handle or a
transaction) as their first argument. A slice that must write more than one row
atomically — and any slice writing an outbox event alongside a domain change —
opens one transaction and passes the `tx` to every helper:

```ts
await deps.db.transaction(async (tx) => {
  const submission = await insertSubmission(tx, ...);
  await enqueue(tx, outboxEvent); // same transaction: the event can't be lost
});
```

Invariants spanning more than one field or row go through a `@qcms/core`
function (load state → call kernel → persist result); a single-row write is a
plain transaction script. No repository interfaces, no mediator (R5).

## Testing (`app.request()`)

Slices are tested against the **real kernel and a real (or absent) database** —
never by mocking our own packages (mocks are for genuine externals: HTTP
receivers, clocks). Two layers:

- **`app.request()` slice tests** (`test.ts`) — compose an app with `createApp`
  (or mount just your group), drive routes with `app.request(path, init)`, and
  assert status + envelope. Build `deps` with the helpers in
  `src/test-support.ts` (`makeDeps`, `validEnv`, `internalTokenFor`,
  `recordingLogger`). Synthetic secrets only — `synthSecret()` — never a real
  value.
- **Live-DB integration** (`*.integration.test.ts`) — for anything that touches
  storage, boot the 013 harness via `@qcms/db/testing` (`startTestDb`). Requires
  Docker.

Every internal-surface request carries the internal service token
(`x-qcms-internal-token`, SEC-4) — tests attach `internalTokenFor(config)`.
`/health` and `/ready` never require it.

## Mount flags and isolation (ADR-09)

A route group that is not mounted has **no routes registered** — a request to an
admin path in a public-only process is a 404, not a 403. Put a slice in the
correct surface bucket so network isolation stays a build-time guarantee. Admin
slices are never visible in a public process.

## Rate limiting

`createApp` provides `deps.rateLimitStore` (in-memory default) and
`src/rate-limit.ts` exports the `rateLimit(...)` middleware factory. Apply it
per group in the slices that need it (026). The store is an interface — a
multi-instance deployment swaps in a Redis-backed implementation of
`RateLimitStore`; that is an **adopter swap, not a dependency here**.

## Secrets and logging (SEC-8)

Never write a real secret into any file (code, test, fixture, doc) — reference
env vars, use `<placeholder>` in prose. Config validation and logs never echo
secret values (the logger redacts secret-shaped fields; config errors name the
env var, never the value). **Answer values are never logged** — log questionIds
and counts, not content.
