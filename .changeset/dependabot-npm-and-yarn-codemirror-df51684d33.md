---
"create-qcms-app": patch
---

Dependency maintenance. No source in these packages changed and their public APIs
are identical; only the ranges below moved.

**create-qcms-app**

Ranges in the app manifests this CLI stamps, regenerated from the canonical
apps by `pnpm qcms:sync-templates`. The CLI's own behaviour is unchanged; a
newly scaffolded project installs the versions this repository resolves:

- `@codemirror/state` 6.7.5 to 6.7.6 (dependencies in apps/admin)
- `@codemirror/view` 6.43.12 to 6.43.13 (dependencies in apps/admin)
