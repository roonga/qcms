---
"create-qcms-app": patch
---

Dependency maintenance. No source in these packages changed and their public APIs
are identical; only the ranges below moved.

**create-qcms-app**

Ranges in the app manifests this CLI stamps, regenerated from the canonical
apps by `pnpm qcms:sync-templates`. The CLI's own behaviour is unchanged; a
newly scaffolded project installs the versions this repository resolves:

- `@hono/node-server` ^2.1.5 to ^2.1.6 (dependencies in apps/api)
- `hono` ^4.13.14 to ^4.13.16 (dependencies in apps/api)
