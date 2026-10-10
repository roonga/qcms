---
"create-qcms-app": patch
---

Dependency maintenance. No source in these packages changed and their public APIs
are identical; only the ranges below moved.

**create-qcms-app**

Ranges in the app manifests this CLI stamps, regenerated from the canonical
apps by `pnpm qcms:sync-templates`. The CLI's own behaviour is unchanged; a
newly scaffolded project installs the versions this repository resolves:

- `next` 16.3.6 to 16.3.8 (dependencies in apps/admin, apps/portal)

This one is a security release, so a scaffolded project wants it rather than
merely tolerating it. 16.3.8 closes six advisories against every `next` from
16.0.0, the highest of them GHSA-cjq9-62q9-8jv4 (CVE-2026-94483, server-side
request forgery in image optimization). Both app templates set
`images: { unoptimized: true }` and ship no `remotePatterns`, which is the
configuration that advisory says is unaffected, so the exposure a scaffold
actually carried was the five remaining cache-poisoning and
information-disclosure findings rather than the headline one.

One cited line moves with it, and nothing it describes changed.
`packages/next/src/build/index.ts` grew by twenty-eight lines above the
`experimental.lockDistDir` block, so the lock acquisition the build wrapper
cites moves from lines 1264-1270 to 1292-1298. `packages/next/src/build/lockfile.ts`
is byte-identical between the two versions, so the message citation at line 225
is unchanged, and next's own `react` and `react-dom` peer ranges are unchanged
too, which is what the exact-pin section quotes them for.
