---
"@roonga/qcms-ui": patch
"create-qcms-app": patch
---

Dependency maintenance. No source in these packages changed and their public APIs
are identical; only the ranges below moved.

**@roonga/qcms-ui**

Ranges a consumer resolves against:

- `react-aria-components` ^1.21.0 to ^1.21.1 (dependencies)

**create-qcms-app**

Ranges in the app manifests this CLI stamps, regenerated from the canonical
apps by `pnpm qcms:sync-templates`. The CLI's own behaviour is unchanged; a
newly scaffolded project installs the versions this repository resolves:

- `@ai-sdk/google` ^4.0.63 to ^4.0.64 (dependencies in apps/api)
- `@ai-sdk/openai` ^4.0.58 to ^4.0.60 (dependencies in apps/api)
- `@ai-sdk/openai-compatible` ^3.0.43 to ^3.0.44 (dependencies in apps/api)
- `ai` ^7.0.92 to ^7.0.93 (dependencies in apps/api)
- `hono` ^4.13.5 to ^4.13.7 (dependencies in apps/api)
