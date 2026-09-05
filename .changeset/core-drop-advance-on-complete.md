---
"@roonga/qcms-core": minor
---

Remove the reserved `advanceOnComplete` boolean from `FormDefinition` (ADR-28,
issue #725). Task 045 reserved the slot without a behaviour behind it, so the
schema said a per-form escape from "answering never changes the rendered step by
itself" existed while the record said it did not. The Code Owner removed the slot
on 2026-08-31: auto-advance returns as a decision with an implementation, not as
a key nothing reads. No fixture, golden document, seed, or admin or portal source
carried the field, and `FormDefinition` strips unknown keys rather than rejecting
them, so a stored document that somehow holds it still parses.
