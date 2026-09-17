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

- `@types/node` ^24.13.3 to ^24.13.4 (devDependencies)

**@roonga/qcms-core**

Ranges a consumer resolves against:

- `zod` ^4.5.4 to ^4.6.5 (dependencies)

Development ranges, which reach no consumer:

- `@types/node` ^24.13.3 to ^24.13.4 (devDependencies)
- `fast-check` ^4.9.0 to ^4.10.0 (devDependencies)

**@roonga/qcms-csv**

Development ranges, which reach no consumer:

- `@types/node` ^24.13.3 to ^24.13.4 (devDependencies)

**@roonga/qcms-observability**

Development ranges, which reach no consumer:

- `@types/node` ^24.13.3 to ^24.13.4 (devDependencies)

**@roonga/qcms-ui**

Ranges a consumer resolves against:

- `zod` ^4.5.4 to ^4.6.5 (dependencies)

Development ranges, which reach no consumer:

- `@testing-library/dom` ^10.4.0 to ^10.4.2 (devDependencies)
- `@types/node` ^24.13.3 to ^24.13.4 (devDependencies)
- `@types/react` ^19.2.18 to ^19.3.0 (devDependencies)
- `@types/react-dom` ^19.2.7 to ^19.3.0 (devDependencies)
- `react` ^19.2.8 to ^19.3.0 (devDependencies)
- `react-dom` ^19.2.8 to ^19.3.0 (devDependencies)

**create-qcms-app**

Development ranges, which reach no consumer:

- `@types/node` ^24.13.3 to ^24.13.4 (devDependencies)

Ranges in the app manifests this CLI stamps, regenerated from the canonical
apps by `pnpm qcms:sync-templates`. The CLI's own behaviour is unchanged; a
newly scaffolded project installs the versions this repository resolves:

- `next` 16.3.4 to 16.3.5 (dependencies in apps/admin, apps/portal)
- `react` 19.2.8 to 19.3.0 (dependencies in apps/admin, apps/portal)
- `react-dom` 19.2.8 to 19.3.0 (dependencies in apps/admin, apps/portal)
- `@testing-library/dom` ^10.4.0 to ^10.4.2 (devDependencies in apps/admin)
- `@types/node` ^24.13.3 to ^24.13.4 (devDependencies in apps/admin, apps/api, apps/portal)
- `@types/react` ^19.2.18 to ^19.3.0 (devDependencies in apps/admin, apps/portal)
- `@types/react-dom` ^19.2.7 to ^19.3.0 (devDependencies in apps/admin, apps/portal)
- `@ai-sdk/anthropic` ^4.0.49 to ^4.0.53 (dependencies in apps/api)
- `@ai-sdk/google` ^4.0.64 to ^4.0.69 (dependencies in apps/api)
- `@ai-sdk/openai` ^4.0.60 to ^4.0.66 (dependencies in apps/api)
- `@ai-sdk/openai-compatible` ^3.0.44 to ^3.0.48 (dependencies in apps/api)
- `ai` ^7.0.93 to ^7.0.100 (dependencies in apps/api)
- `zod` ^4.5.4 to ^4.6.5 (dependencies in apps/api, apps/portal)
