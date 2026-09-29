---
"create-qcms-app": patch
---

Dependency maintenance. No source in this package changed and its public API is
identical; only the range below and the version named in the templates moved.

**create-qcms-app**

The exact `better-auth` pin in the app manifest this CLI stamps, and the version
each generated comment names, regenerated from the canonical apps by
`pnpm qcms:sync-templates`. The CLI's own behaviour is unchanged; a newly
scaffolded project installs the version this repository resolves:

- `better-auth` 1.7.5 to 1.7.6 (dependencies in apps/api)

One cited line moves with it. `dist/api/routes/update-user.mjs` factors its two
inline password-length checks out to `assertPasswordNotTooShort` and
`assertPasswordNotTooLong`, which is six lines shorter, so the change-password
hash-before-verify pair the scaffolded `password-refusal.ts` cites moves from
`:173` and `:174-177` to `:167` and `:168-171`. The ordering it documents, and
therefore the accepted oracle recorded beside it, is unchanged.
