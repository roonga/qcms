---
"@qcms/core": minor
"@qcms/ui": patch
---

Blank text is absence, and an empty value is not an answer.

Two Code Owner rulings, landed together because they are the same boundary seen from two sides.

**Required means non-blank (issue #128).** An empty or whitespace-only text value no longer counts as an answer. `evaluateRules` drops it while canonicalizing, so the `answered` operator, every value operator and the required accounting agree; `prepareSubmission` uses the same predicate, so a blank value fails a required question with `MISSING_REQUIRED` and never enters the locked set or the content hash. Stored values are untouched: trimming settles the presence test only, so a respondent's `" "` stays verbatim in the ledger and in exports. The new predicate is exported as `isBlankAnswerValue`.

**An empty value is refused at ingest (ADR-33).** `validateAnswer` now rejects `""` (shortText, longText) and `[]` (multiChoice) with the new `EMPTY_ANSWER_NOT_ALLOWED` code under the `encoding` constraint, alone rather than joined to the question's own constraint failures, and with a message naming the `null` retraction as the way to clear an answer. It rejects; it never converts an empty post into a retraction. This closes the hole where the renderer and the no-JS decoder enforced "empty is absence" but a direct API post of `""` or `[]` was stored and satisfied `required`.

`minor` rather than `patch`: `isBlankAnswerValue` is a new export, `ValidationErrorCode` gains a member, and evaluation and validation outcomes change for values that were previously accepted.

Implemented under `SEMANTICS_VERSION` 1 rather than a bump. The evaluator implements one version at a time and refuses any other stamp, so a bump would not preserve old snapshots' behavior; it would fail every published snapshot at submit. No answer the product can produce changes meaning: both control boundaries have reported an emptied field as absence since issue #98, and the same change makes `""` and `[]` unstorable. The reasoning is recorded in the ADR-16 amendment and in the golden corpus's CORPUS.md.
