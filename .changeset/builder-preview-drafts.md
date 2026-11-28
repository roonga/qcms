---
"@roonga/qcms-core": minor
"create-qcms-app": patch
---

Let the admin draft preview compile a pin onto an unpublished question version.

`DraftInput` gains an optional `allowUnpublishedPins`. When it is set, `compileDraft` no
longer raises `UNPUBLISHED_QUESTION_PIN`; every other gate, `DANGLING_QUESTION_REF`
included, is unchanged, so a pin that does not resolve at all is still refused. The field is
absent rather than defaulted, so a caller that does not set it compiles exactly as before.

The admin's `POST /forms/{id}/draft/preview` is the only caller that sets it (Code Owner,
2026-11-28, "Preview drafts"): the agent builder writes question versions as drafts, so an
author previewing the form they are editing met a blank pane instead of their draft. Publish,
release and the portal take the strict call, so R1 holds for every snapshot that is kept, and
the unpublished-pin set the propose tool is bound to is still the one the publish compile
reports. See the Note on ADR-02 in `docs/adr/core.md`.
