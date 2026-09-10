---
"create-qcms-app": patch
---

Carry the better-auth citation expectation markers into the scaffolded API's auth
instance (issue #864).

Comment-only. `apps/api/src/features/auth/instance.ts` justifies several security
properties by citing better-auth's compiled source at a `file:line`, and eleven of those
citations now carry an `expect` marker naming a short phrase the cited lines must
contain. `pnpm vendor:cite --expect` reads them, so a line that shifts under prose that
did not move is a failure rather than something only a careful re-read would find. The
template is generated from `apps/**` and the seam gate demands byte fidelity, so the
markers land here too; nothing a scaffolded project runs changes.
