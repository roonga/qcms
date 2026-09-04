# qcms-api - slice conventions

This app is the Hono **composition root** (task 017). It owns the middleware,
mount flags, health/ready, config, and the in-process schedulers. Feature work
lands as **vertical slices** (018–026) that mount into this shell. This document
is the contract those slices conform to. It complements the root `CONTRIBUTING.md`
and `PROJECT_INSTRUCTIONS.md` (R1–R7, SEC-1…12) - where they overlap, those win.

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
to `createApp`. A slice never constructs its own app or reads the environment -
it receives everything through `deps`.

## Route-definition convention (mandatory)

Routes are declared with `@hono/zod-openapi`'s `createRoute` - **never** bare
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
    200: {
      description: "The current step",
      content: { "application/json": { schema: StepResponse } },
    },
    ...errorResponses(401, 404),
  },
  ...withScopes("responses:read"),
});
```

## Handlers stay fetch-pure (R4)

Handlers use only Web APIs and injected collaborators - **no `node:*`**. Time is
`deps.clock`, logging is `deps.logger`, crypto is WebCrypto (`crypto.subtle`),
signing keys and config come from `deps.config`, flags from `deps.flags`. The
only place Node built-ins are allowed is `serve.ts` (the process boundary) and
test files. This is what lets the same handler run on Node or an edge runtime.

## Transaction ownership

The **slice owns the transaction boundary**, never the query helpers (R3, R5).
Query helpers from `@roonga/qcms-db` take an `Executor` (a Drizzle handle or a
transaction) as their first argument. A slice that must write more than one row
atomically - and any slice writing an outbox event alongside a domain change -
opens one transaction and passes the `tx` to every helper:

```ts
await deps.db.transaction(async (tx) => {
  const submission = await insertSubmission(tx, ...);
  await enqueue(tx, outboxEvent); // same transaction: the event can't be lost
});
```

Invariants spanning more than one field or row go through a `@roonga/qcms-core`
function (load state → call kernel → persist result); a single-row write is a
plain transaction script. No repository interfaces, no mediator (R5).

## Testing (`app.request()`)

Slices are tested against the **real kernel and a real (or absent) database** -
never by mocking our own packages (mocks are for genuine externals: HTTP
receivers, clocks). Two layers:

- **`app.request()` slice tests** (`test.ts`) - compose an app with `createApp`
  (or mount just your group), drive routes with `app.request(path, init)`, and
  assert status + envelope. Build `deps` with the helpers in
  `src/test-support.ts` (`makeDeps`, `validEnv`, `internalTokenFor`,
  `recordingLogger`). Synthetic secrets only - `synthSecret()` - never a real
  value.
- **Live-DB integration** (`*.integration.test.ts`) - for anything that touches
  storage, boot the 013 harness via `@roonga/qcms-db/testing` (`startTestDb`). Requires
  Docker.

Every internal-surface request carries the internal service token
(`x-qcms-internal-token`, SEC-4) - tests attach `internalTokenFor(config)`.
`/health` and `/ready` never require it.

### Running one test file (issue #387)

This app's `test` script is:

```sh
vitest run --root ../.. --project qcms-api --project qcms-api-e2e
```

One root `vitest.config.ts` owns every project, so a direct invocation has to
carry the same `--root` and `--project`. Either form below works, and the path
is relative to the **process working directory**, not to `--root`:

```sh
# From apps/api.
pnpm exec vitest run --root ../.. --project qcms-api src/rate-limit.test.ts

# From the repo root.
pnpm exec vitest run --project qcms-api apps/api/src/rate-limit.test.ts
```

Two ways this fails silently, both worth recognising because neither says what
is wrong. `pnpm --filter qcms-api exec vitest run <path>` drops the `--root`, so
Vitest walks up to the root config from the wrong side, searches only the
projects that declare an explicit `root`, and exits `No test files found` - which
reads as "nothing to run" rather than "your invocation is wrong". And
`apps/api/src/rate-limit.test.ts` matches nothing when you run it from
`apps/api`, because that path does not exist relative to where you are standing.

A bare substring (`rate-limit`) works too, and is the loose form: it also matches
`src/features/responses/rate-limits.test.ts`. In a fresh worktree, run
`pnpm build` first, or the first workspace import fails with `Failed to resolve
entry for package "@roonga/qcms-db"`; `pnpm test` never shows this because turbo's
`test` task builds first.

### Compiled A2UI fixtures (issue #321)

`e2e/support/fixtures/*.a2ui.json` are compiled A2UI documents. `seed.ts` stores
them in `form_versions` verbatim, exactly as the serve path later replays them
(ADR-18), and several API and browser specs assert against what comes back out.
That makes them a claim about the compiler, and the claim has to be checked:
before issue #321 nothing recompiled them, so a `@roonga/qcms-a2ui-compiler` change
desynced them **silently** - every spec kept passing against a document the
compiler no longer produced. The insurance read had drifted a whole corpus
generation behind before anyone noticed.

Two rules follow, and both are mechanical:

- **Every committed compiled document gets a row in `COMPILED_FIXTURES`**
  (`e2e/support/fixtures.ts`): the file path plus the form and question
  definitions it was compiled from. `e2e/support/fixture-drift.test.ts` rebuilds
  each one through the real publish path (`compileDraft` then `compileForm`, the
  same pair `makePublishFormHandler` calls) and asserts byte equality with the
  file. Byte, not deep: key order and formatting are part of the determinism
  contract, and the bytes are what a respondent is served. Adding a compiled
  fixture without its row leaves it unguarded.
- **Never write a corpus generation into a path here.** The insurance document
  belongs to the append-only corpus, and its generation directory is derived from
  the live `COMPILER_VERSION` (`currentGoldenGeneration()`), so a future `v3/` is
  followed with no edit and a version bump landed without its generation throws
  instead of silently reverting to older bytes.

When a compiler change legitimately alters the output, regenerate the `apps/api`
fixtures (never the corpus, which is frozen):

```sh
UPDATE_API_FIXTURES=1 pnpm exec vitest run --root . --project qcms-api fixture-drift
```

Review the diff by eye before committing, as `UPDATE_GOLDEN=1` demands of the
corpus. `pnpm lint` re-runs `check:fixture-domain` over the directory, so
regenerated content that leaves the neutral vehicle domain (task 043) fails
there. The flag never writes a `regenerable: false` row: a divergence under
`packages/a2ui-compiler/golden/` is a spec-bump question for that corpus
(`packages/a2ui-compiler/golden/README.md`), not a regeneration.

## Mount flags and isolation (ADR-09)

A route group that is not mounted has **no routes registered** - a request to an
admin path in a public-only process is a 404, not a 403. Put a slice in the
correct surface bucket so network isolation stays a build-time guarantee. Admin
slices are never visible in a public process.

## Rate limiting

`createApp` provides `deps.rateLimitStore` (in-memory default) and
`src/rate-limit.ts` exports the `rateLimit(...)` middleware factory. Apply it
per group in the slices that need it (026). The store is an interface - a
multi-instance deployment swaps in a Redis-backed implementation of
`RateLimitStore`; that is an **adopter swap, not a dependency here**.

The in-memory store holds at most `maxKeys` entries (default 100,000, a
constructor argument that must be a positive integer: anything else throws at
construction rather than being coerced into a capacity the store cannot honor,
issue #392). What bounds the heap is **eviction**: when the map is full it drops
the least recently hit entry. Insertions also check the 8 coldest entries for
expired buckets and drop those, which keeps a quiet deployment near its live key
count, but that is opportunistic housekeeping over a handful of entries, not a
sweep of the map, and the bound does not rest on it (issue #376). Two things
follow for anyone adding a limiter: a new `keyFor` may key on anything without
leaking memory, and eviction forgives a count, so a limiter whose correctness
depends on a count surviving indefinitely needs a shared store rather than this
one.

**Mount a limiter ahead of the handler, not behind validation.** The work a
handler does to validate a credential (a database read, a signature verify) is
the work the limiter is there to shield; moving it after that hands an
unauthenticated caller a free path to it.

**Never key a limiter on `X-Forwarded-For` or `X-Real-IP`.** Those are claims the
caller can write, so keying on one hands every caller a bucket of its own. The
client address comes from `src/client-address.ts`, which reads the header a BFF
vouched on after resolving the trust chain (issue #341); it is also the default
`keyFor`. The value is a bucket key and nothing else: never log it, never put it
in a span, never persist it.

That applies to a **vendored** limiter too, and the rule there is to point the
library at the same header rather than to trust its default. better-auth's
sign-in throttle (SEC-1) resolves an address from
`advanced.ipAddress.ipAddressHeaders`, whose default is `x-forwarded-for`;
`features/auth/instance.ts` names the vouched header instead, because the admin
BFF used to relay the browser's own copy of that header and the throttle keyed on
a value the caller chose (issue #374). If you configure another library that
resolves a client address, do the same, and pin it by driving the library rather
than by reading its options back (`features/auth/sign-in-throttle.test.ts`).

## Secrets and logging (SEC-8)

Never write a real secret into any file (code, test, fixture, doc) - reference
env vars, use `<placeholder>` in prose. Config validation and logs never echo
secret values (the logger redacts secret-shaped fields; config errors name the
env var, never the value). **Answer values are never logged** - log questionIds
and counts, not content.
