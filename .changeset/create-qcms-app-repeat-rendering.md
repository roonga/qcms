---
"create-qcms-app": patch
---

The scaffolded portal and admin carry task 073's repeat rendering and the amended SEC-9
referrer policy.

The portal template serves `Referrer-Policy: same-origin` and the admin keeps
`no-referrer`, which is what lets the no-JS Add and Remove of a repeating group work: it
posts to a Next Server Action, and Next refuses an action whose `Origin` is the literal
`null` that `no-referrer` makes a form navigation send. The template's step views, its
whole-step BFF route, its origin-belt vocabulary and its API config move with it.

An operator's ingress must leave the portal's `Referrer-Policy` alone and pass the real
`Host`; `docs/deploy-ingress.md` says what breaks otherwise, and it fails closed.
