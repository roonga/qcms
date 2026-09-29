---
"@roonga/qcms-db": patch
"@roonga/qcms-ui": patch
"create-qcms-app": patch
---

Dependency maintenance. No source in these packages changed and their public APIs
are identical; only the ranges below moved.

**@roonga/qcms-db**

Ranges a consumer resolves against:

- `drizzle-orm` ^0.45.2 to ^0.45.3 (dependencies)

Development ranges, which reach no consumer:

- `drizzle-kit` ^0.31.10 to ^0.31.11 (devDependencies)

**@roonga/qcms-ui**

Development ranges, which reach no consumer:

- `jsdom` ^30.1.0 to ^30.1.1 (devDependencies)

**create-qcms-app**

Ranges in the app manifests this CLI stamps, regenerated from the canonical
apps by `pnpm qcms:sync-templates`. The CLI's own behaviour is unchanged; a
newly scaffolded project installs the versions this repository resolves:

- `next` 16.3.5 to 16.3.6 (dependencies in apps/admin, apps/portal)
- `jsdom` ^30.1.0 to ^30.1.1 (devDependencies in apps/admin)
- `@ai-sdk/anthropic` ^4.0.58 to ^4.0.63 (dependencies in apps/api)
- `@ai-sdk/google` ^4.0.76 to ^4.0.80 (dependencies in apps/api)
- `@ai-sdk/openai` ^4.0.71 to ^4.0.75 (dependencies in apps/api)
- `@ai-sdk/openai-compatible` ^3.0.53 to ^3.0.55 (dependencies in apps/api)
- `ai` ^7.0.107 to ^7.0.114 (dependencies in apps/api)
- `drizzle-orm` ^0.45.2 to ^0.45.3 (dependencies in apps/api)
- `hono` ^4.13.8 to ^4.13.9 (dependencies in apps/api)
