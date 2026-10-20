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

- `@types/node` ^24.19.1 to ^24.19.2 (devDependencies)

**@roonga/qcms-core**

Ranges a consumer resolves against:

- `zod` ^4.6.5 to ^4.6.7 (dependencies)

Development ranges, which reach no consumer:

- `@types/node` ^24.19.1 to ^24.19.2 (devDependencies)

**@roonga/qcms-csv**

Development ranges, which reach no consumer:

- `@types/node` ^24.19.1 to ^24.19.2 (devDependencies)

**@roonga/qcms-db**

Ranges a consumer resolves against:

- `drizzle-orm` ^0.45.3 to ^0.45.4 (dependencies)
- `@testcontainers/postgresql` ^12.2.0 to ^12.2.1 (peerDependencies)
- `testcontainers` ^12.2.0 to ^12.2.1 (peerDependencies)

Development ranges, which reach no consumer:

- `@testcontainers/postgresql` ^12.2.0 to ^12.2.1 (devDependencies)
- `@types/node` ^24.19.1 to ^24.19.2 (devDependencies)
- `testcontainers` ^12.2.0 to ^12.2.1 (devDependencies)

**@roonga/qcms-observability**

Development ranges, which reach no consumer:

- `@types/node` ^24.19.1 to ^24.19.2 (devDependencies)

**@roonga/qcms-ui**

Ranges a consumer resolves against:

- `react-aria-components` ^1.21.1 to ^1.22.1 (dependencies)
- `zod` ^4.6.5 to ^4.6.7 (dependencies)

Development ranges, which reach no consumer:

- `@testing-library/user-event` ^14.6.7 to ^14.6.8 (devDependencies)
- `@types/node` ^24.19.1 to ^24.19.2 (devDependencies)
- `jsdom` ^30.1.2 to ^30.1.3 (devDependencies)
- `react` ^19.3.0 to ^19.3.1 (devDependencies)
- `react-dom` ^19.3.0 to ^19.3.1 (devDependencies)

**create-qcms-app**

Development ranges, which reach no consumer:

- `@types/node` ^24.19.1 to ^24.19.2 (devDependencies)

Ranges in the app manifests this CLI stamps, regenerated from the canonical
apps by `pnpm qcms:sync-templates`. The CLI's own behaviour is unchanged; a
newly scaffolded project installs the versions this repository resolves:

- `next` 16.4.0 to 16.4.2 (dependencies in apps/admin, apps/portal)
- `react` 19.3.0 to 19.3.1 (dependencies in apps/admin, apps/portal)
- `react-dom` 19.3.0 to 19.3.1 (dependencies in apps/admin, apps/portal)
- `@testing-library/user-event` ^14.6.7 to ^14.6.8 (devDependencies in apps/admin)
- `@types/node` ^24.19.1 to ^24.19.2 (devDependencies in apps/admin, apps/api, apps/portal)
- `jsdom` ^30.1.2 to ^30.1.3 (devDependencies in apps/admin)
- `@ai-sdk/anthropic` ^4.0.72 to ^4.0.81 (dependencies in apps/api)
- `@ai-sdk/google` ^4.0.88 to ^4.0.98 (dependencies in apps/api)
- `@ai-sdk/openai` ^4.0.84 to ^4.0.95 (dependencies in apps/api)
- `@ai-sdk/openai-compatible` ^3.0.63 to ^3.0.70 (dependencies in apps/api)
- `@hono/node-server` ^2.1.3 to ^2.1.5 (dependencies in apps/api)
- `@opentelemetry/instrumentation-pg` ^0.75.0 to ^0.76.0 (dependencies in apps/api)
- `ai` ^7.0.128 to ^7.0.142 (dependencies in apps/api)
- `drizzle-orm` ^0.45.3 to ^0.45.4 (dependencies in apps/api)
- `zod` ^4.6.5 to ^4.6.7 (dependencies in apps/api, apps/portal)
