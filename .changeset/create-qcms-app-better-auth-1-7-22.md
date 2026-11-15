---
"create-qcms-app": patch
---

Move the scaffolding templates to better-auth 1.7.22.

- The exact pin in the stamped `apps/api` manifest goes from better-auth 1.7.14 to 1.7.22.
- The scaffolded `instance.ts` carries the re-read citations: lines in the two-factor plugin, `dist/db/internal-adapter.mjs` and `@better-auth/core`'s `dist/env/env-impl.mjs` moved; the code they describe did not.
- Comments only; no template behaviour changes.
