---
"@roonga/qcms-a2ui-compiler": patch
"@roonga/qcms-core": patch
"@roonga/qcms-csv": patch
"@roonga/qcms-db": minor
"@roonga/qcms-observability": patch
"@roonga/qcms-ui": patch
"create-qcms-app": patch
---

Dependency maintenance. No source in these packages changed and their public APIs
are identical; only the ranges below moved.

**@roonga/qcms-a2ui-compiler**

Development ranges, which reach no consumer:

- `@types/node` ^24.13.6 to ^24.19.1 (devDependencies)

**@roonga/qcms-core**

Development ranges, which reach no consumer:

- `@types/node` ^24.13.6 to ^24.19.1 (devDependencies)

**@roonga/qcms-csv**

Development ranges, which reach no consumer:

- `@types/node` ^24.13.6 to ^24.19.1 (devDependencies)

**@roonga/qcms-db**

Ranges a consumer resolves against:

- `pg` ^8.23.0 to ^8.23.1 (dependencies)
- `@testcontainers/postgresql` ^12.1.0 to ^12.2.0 (peerDependencies)
- `testcontainers` ^12.1.0 to ^12.2.0 (peerDependencies)

Development ranges, which reach no consumer:

- `@testcontainers/postgresql` ^12.1.0 to ^12.2.0 (devDependencies)
- `testcontainers` ^12.1.0 to ^12.2.0 (devDependencies)
- `@types/node` ^24.19.1 **added** (devDependencies)

That last one is not a bump, and it is the one thing in this group that needed a
fix rather than a carry. This package was the only one of the six that declared no
`@types/node` of its own, so it borrowed Node types transitively through
`@types/pg` and typechecked against whatever version that happened to resolve.
Moving `@types/node` to ^24.19.1 elsewhere changed which copy won, three copies
entered one program at once (18.19.130, 24.19.1 and 26.6.1, the last through
`vitest`'s peer), all three declare the `net` module ambiently, and
`src/testing/refused-connect.test.ts` stopped compiling on
`Property 'once' does not exist on type 'Server'`. Declaring the dependency pins
which copy is nearest and the error goes with it. It is the same class as the
`@codemirror/view` `KeyBinding` ambiguity CONTRIBUTING describes, one package
along, and it is dev-only, so no consumer resolves it.

**@roonga/qcms-observability**

Ranges a consumer resolves against:

- `@opentelemetry/api-logs` ^0.222.0 to ^0.223.0 (dependencies)
- `@opentelemetry/sdk-logs` ^0.222.0 to ^0.223.0 (dependencies)
- `@opentelemetry/sdk-trace-base` ^2.11.0 to ^2.12.0 (dependencies)

Development ranges, which reach no consumer:

- `@types/node` ^24.13.6 to ^24.19.1 (devDependencies)

**@roonga/qcms-ui**

Development ranges, which reach no consumer:

- `@types/node` ^24.13.6 to ^24.19.1 (devDependencies)
- `axe-core` ^4.13.0 to ^4.14.0 (devDependencies)
- `jsdom` ^30.1.1 to ^30.1.2 (devDependencies)

**create-qcms-app**

Development ranges, which reach no consumer:

- `@types/node` ^24.13.6 to ^24.19.1 (devDependencies)

Ranges in the app manifests this CLI stamps, regenerated from the canonical
apps by `pnpm qcms:sync-templates`. The CLI's own behaviour is unchanged; a
newly scaffolded project installs the versions this repository resolves:

- `@opentelemetry/api-logs` ^0.222.0 to ^0.223.0 (dependencies in apps/admin, apps/portal)
- `@opentelemetry/exporter-logs-otlp-http` ^0.222.0 to ^0.223.0 (dependencies in apps/admin, apps/api, apps/portal)
- `@opentelemetry/sdk-logs` ^0.222.0 to ^0.223.0 (dependencies in apps/admin, apps/api, apps/portal)
- `@opentelemetry/sdk-trace-base` ^2.11.0 to ^2.12.0 (dependencies in apps/admin, apps/portal)
- `next` 16.3.8 to 16.4.0 (dependencies in apps/admin, apps/portal)
- `@types/node` ^24.13.6 to ^24.19.1 (devDependencies in apps/admin, apps/api, apps/portal)
- `jsdom` ^30.1.1 to ^30.1.2 (devDependencies in apps/admin)
- `@ai-sdk/anthropic` ^4.0.63 to ^4.0.72 (dependencies in apps/api)
- `@ai-sdk/google` ^4.0.80 to ^4.0.88 (dependencies in apps/api)
- `@ai-sdk/openai` ^4.0.75 to ^4.0.84 (dependencies in apps/api)
- `@ai-sdk/openai-compatible` ^3.0.55 to ^3.0.63 (dependencies in apps/api)
- `@hono/node-server` ^2.1.1 to ^2.1.3 (dependencies in apps/api)
- `@hono/otel` ^1.1.2 to ^1.2.0 (dependencies in apps/api)
- `@opentelemetry/exporter-trace-otlp-http` ^0.222.0 to ^0.223.0 (dependencies in apps/api)
- `@opentelemetry/instrumentation-http` ^0.222.0 to ^0.223.0 (dependencies in apps/api)
- `@opentelemetry/instrumentation-pg` ^0.74.0 to ^0.75.0 (dependencies in apps/api)
- `@opentelemetry/instrumentation-undici` ^0.32.0 to ^0.33.0 (dependencies in apps/api)
- `@opentelemetry/sdk-node` ^0.222.0 to ^0.223.0 (dependencies in apps/api)
- `@opentelemetry/sdk-trace` ^2.11.0 to ^2.12.0 (dependencies in apps/api)
- `ai` ^7.0.114 to ^7.0.128 (dependencies in apps/api)
- `hono` ^4.13.9 to ^4.13.13 (dependencies in apps/api)
- `pg` ^8.23.0 to ^8.23.1 (dependencies in apps/api)
- `@opentelemetry/instrumentation` ^0.222.0 to ^0.223.0 (dependencies in apps/portal)

**What in this group is not routine**

Four of the thirty-four carry something a reviewer should see named, and the
remaining thirty are ordinary patch and minor moves with no advisory and no
breaking change recorded upstream.

`hono` 4.13.9 to 4.13.13 carries GHSA-5r4p-p66f-jhc7 (medium, CVSS 5.3, fixed in
4.13.11): `serveStatic` decoded the request path a second time, so a crafted
request could be routed as one path and served as another, skipping middleware
mounted on a static prefix. `@hono/node-server` 2.1.3 carries the same fix. The
API imports `hono/body-limit`, `hono/http-exception` and `hono/secure-headers`
and no static-file middleware at all, so neither the advisory nor the fix's new
refusal of a literal `%` in a request path reaches this repository. Two
deprecations in the same range do not reach it either: the runtime adapters move
to their own packages, and `app.mount()` is deprecated for removal in hono 5,
and the API uses neither.

`pg` 8.23.0 to 8.23.1 has no advisory but does carry a real TLS fix: the server
certificate is now validated against the host when connecting to an IP address
(brianc/node-postgres#3756), which was a hostname-verification gap. It also
deprecates serializing an invalid `Date`.

`@opentelemetry/*` 0.222.0 to 0.223.0 carries one breaking change, and it is in a
part of the tree this repository does not use: the network span utils are
deprecated and moved out of `@opentelemetry/sdk-trace-web`, and
`addSpanNetworkEvents()` loses its `skipOldSemconvContentLengthAttrs` option.
Only the already-deprecated fetch and XHR instrumentations consume them, and
nothing here imports `sdk-trace-web` or either instrumentation.

`jsdom` 30.1.1 to 30.1.2 is a correctness release rather than a no-op, so DOM
test behaviour can genuinely move: it repairs a severe large-tree slowdown
introduced in 30.1.0, stale `getComputedStyle()` after stylesheet edits, focus
pseudo-class evaluation, and two memory leaks. Its `engines.node` is unchanged
at `^22.22.2 || ^24.15.0 || >=26.0.0`, so the root Node floor does not move.

`axe-core` 4.13 to 4.14, `eslint` 10.11 to 10.12 and `typescript-eslint` 8.70.1
to 8.71.1 each change what a rule reports, and 8.71.0 adds one new rule
(`no-unsafe-enum-assignment`), so lint and accessibility output can shift without
any API moving. `turbo` 2.11.4 to 2.11.7 normalises task inputs and stabilises
pnpm per-workspace lockfile hashes, which invalidates existing cache keys on the
first run after it lands.
