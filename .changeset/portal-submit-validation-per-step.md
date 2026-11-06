---
"create-qcms-app": patch
---

Scaffold the portal's per-step report of a refused submit. The submit slice's 422 names
the questions it refused, and both portal paths now draw those messages beside the
questions themselves: on the step that asks each one, with the author's message for the
constraint that failed where there is one, and the error summary naming the other steps
that still need attention. The no-JS re-render carries the same verdict through its step
context. Scaffolded apps pick this up as a template change only; no generator input moved.
