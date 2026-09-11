---
"create-qcms-app": patch
---

Carry the two `qcms/no-unhandled-then` disable comments into the scaffolded source
(issue #809).

The monorepo gained a local ESLint rule that reports a discarded promise chain ending in
`.then(...)` with no rejection handler, and its two sites in this repository resolve to an
inline disable naming why the promise cannot reject rather than to a handler no test could
reach. Both sites are files the template tree copies byte for byte -
`apps/admin/components/recovery-codes.tsx` and `apps/api/src/schedulers/scheduler.ts` - so
the comments arrive in a scaffolded project too.

Nothing a scaffolded project runs changes. It ships no ESLint configuration, so it has no
`qcms` plugin and the directives are inert prose, exactly like the `sonarjs/*` disables the
templates already carry. What they leave behind is the reasoning for code the adopter now
owns, which is the tier-3 rule in `docs/ownership-seam.md`: the comment says the promise
resolves on every path and where that is guaranteed, which is worth more to whoever reads
it next than a tidy file.
