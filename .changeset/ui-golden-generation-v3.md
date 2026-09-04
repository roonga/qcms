---
"@roonga/qcms-ui": patch
---

Load the new `golden/v3/` generation in the renderer's conformance input, so the suite
keeps covering every generation of compiled document rather than only the ones that existed
when the list was written (issue #186).

`test-support/golden.ts` enumerated `v1` and `v2` by hand. That is the right shape - a
snapshot published under an older compiler is served from its stored bytes forever (R1,
ADR-18), so the renderer has to keep handling every generation, not just the newest - but a
hand-written list silently stops covering the newest one the moment a generation is
appended. Adding `v3` restores that, and the corpus README now names this file as one of
the three places a new generation has to be registered.

Test-support only; no change to any published runtime behaviour.
