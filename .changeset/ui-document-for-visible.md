---
"@qcms/ui": minor
---

Export `documentForVisible(document, visibleQuestions)`, the projection that
drops the questions an authoritative forward pass says are not visible from a
compiled step document (task 034).

It was the portal's private helper. The admin's draft preview needs the identical
projection, and preview fidelity is the reason this package exists at all
(ARCHITECTURE §6): a second copy of it is exactly how "what the author saw" and
"what the respondent got" would quietly diverge. So it now ships beside the
renderer it feeds, and both apps call the same function on the same document with
the same visible set.

This is presentation over an authoritative projection, not rule evaluation:
neither frontend evaluates rules (R2), and the compiled document is never
mutated (ADR-18).
