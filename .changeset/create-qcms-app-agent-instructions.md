---
"create-qcms-app": patch
---

Keep agent instruction files out of the scaffolded tree (issue #700).

`AGENTS.md` and its `CLAUDE.md` alias are now dropped wherever they appear in an app, by
the same strip rule that drops this repository's tests and runner configuration. The file
that prompted it, `apps/admin/app/(shell)/AGENTS.md`, is entirely about registering a new
screen in tables that live in Vitest and Playwright sources the scaffold does not carry,
so stamping it into an adopter's project would hand them instructions about files their
tree does not contain.

No generated template file changes: the exclusion prevents an addition rather than
removing anything a previous sync produced.
