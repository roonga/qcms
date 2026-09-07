---
"@roonga/qcms-ui": patch
"create-qcms-app": patch
---

Dependency maintenance. No source in these packages changed and their public APIs
are identical; only the ranges below moved.

**@roonga/qcms-ui**

Development ranges, which reach no consumer:

- `@testing-library/user-event` ^14.6.6 to ^14.6.7 (devDependencies)
- `@types/react-dom` ^19.2.5 to ^19.2.7 (devDependencies)

**create-qcms-app**

Ranges in the app manifests this CLI stamps, regenerated from the canonical
apps by `pnpm qcms:sync-templates`. The CLI's own behaviour is unchanged; a
newly scaffolded project installs the versions this repository resolves:

- `@codemirror/state` 6.7.2 to 6.7.4 (dependencies in apps/admin)
- `@codemirror/view` 6.43.10 to 6.43.11 (dependencies in apps/admin)
- `@testing-library/user-event` ^14.6.6 to ^14.6.7 (devDependencies in apps/admin)
- `@types/react-dom` ^19.2.5 to ^19.2.7 (devDependencies in apps/admin, apps/portal)
- `@ai-sdk/openai` ^4.0.57 to ^4.0.58 (dependencies in apps/api)
- `@hono/zod-openapi` ^1.6.1 to ^1.6.3 (dependencies in apps/api)
- `ai` ^7.0.91 to ^7.0.92 (dependencies in apps/api)
