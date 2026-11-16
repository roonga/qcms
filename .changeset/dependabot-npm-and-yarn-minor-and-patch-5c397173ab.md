---
"@roonga/qcms-ui": patch
"create-qcms-app": patch
---

Dependency maintenance. No source in these packages changed and their public APIs
are identical; only the ranges below moved.

**@roonga/qcms-ui**

Development ranges, which reach no consumer:

- `@testing-library/user-event` ^14.6.8 to ^14.6.10 (devDependencies)

**create-qcms-app**

Ranges in the app manifests this CLI stamps, regenerated from the canonical
apps by `pnpm qcms:sync-templates`. The CLI's own behaviour is unchanged; a
newly scaffolded project installs the versions this repository resolves:

- `@vercel/otel` ^2.2.0 to ^2.3.0 (dependencies in apps/admin, apps/portal)
- `next` 16.4.3 to 16.4.6 (dependencies in apps/admin, apps/portal)
- `@tailwindcss/postcss` ^4.3.3 to ^4.3.5 (devDependencies in apps/admin, apps/portal)
- `@testing-library/user-event` ^14.6.8 to ^14.6.10 (devDependencies in apps/admin)
- `tailwindcss` ^4.3.3 to ^4.3.5 (devDependencies in apps/admin, apps/portal)
- `@ai-sdk/anthropic` ^4.0.93 to ^4.0.103 (dependencies in apps/api)
- `@ai-sdk/google` ^4.0.109 to ^4.0.119 (dependencies in apps/api)
- `@ai-sdk/openai` ^4.0.106 to ^4.0.115 (dependencies in apps/api)
- `@ai-sdk/openai-compatible` ^3.0.82 to ^3.0.91 (dependencies in apps/api)
- `ai` ^7.0.158 to ^7.0.171 (dependencies in apps/api)
