---
"@roonga/qcms-a2ui-compiler": patch
"@roonga/qcms-core": patch
"@roonga/qcms-csv": patch
"@roonga/qcms-observability": patch
"@roonga/qcms-ui": patch
"create-qcms-app": patch
---

Dependency maintenance. No source in these packages changed and their public APIs
are identical; only the ranges below moved.

**@roonga/qcms-a2ui-compiler**

Development ranges, which reach no consumer:

- `@types/node` ^24.13.4 to ^24.13.6 (devDependencies)

**@roonga/qcms-core**

Development ranges, which reach no consumer:

- `@types/node` ^24.13.4 to ^24.13.6 (devDependencies)
- `fast-check` ^4.10.1 to ^4.10.2 (devDependencies)

**@roonga/qcms-csv**

Development ranges, which reach no consumer:

- `@types/node` ^24.13.4 to ^24.13.6 (devDependencies)

**@roonga/qcms-observability**

Development ranges, which reach no consumer:

- `@types/node` ^24.13.4 to ^24.13.6 (devDependencies)

**@roonga/qcms-ui**

Development ranges, which reach no consumer:

- `@types/node` ^24.13.4 to ^24.13.6 (devDependencies)

**create-qcms-app**

Development ranges, which reach no consumer:

- `@types/node` ^24.13.4 to ^24.13.6 (devDependencies)

Ranges in the app manifests this CLI stamps, regenerated from the canonical
apps by `pnpm qcms:sync-templates`. The CLI's own behaviour is unchanged; a
newly scaffolded project installs the versions this repository resolves:

- `@types/node` ^24.13.4 to ^24.13.6 (devDependencies in apps/admin, apps/api, apps/portal)
- `@ai-sdk/anthropic` ^4.0.56 to ^4.0.58 (dependencies in apps/api)
- `@ai-sdk/google` ^4.0.74 to ^4.0.76 (dependencies in apps/api)
- `@ai-sdk/openai` ^4.0.69 to ^4.0.71 (dependencies in apps/api)
- `@ai-sdk/openai-compatible` ^3.0.51 to ^3.0.53 (dependencies in apps/api)
- `ai` ^7.0.105 to ^7.0.107 (dependencies in apps/api)
