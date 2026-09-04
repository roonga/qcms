---
"@roonga/qcms-db": minor
"@roonga/qcms-ui": patch
---

Retract a cleared answer instead of silently keeping the stale one (issue #95,
ADR-33). A respondent who answered a required question and then cleared it kept
Continue working: the server never learned about the clear and honored the stored
answer, and validation, exports and any answer-gated branch honored it too.

`@roonga/qcms-db` (minor: additive API plus a schema migration adopters must apply).
The `answers` ledger gains a `retracted` discriminator; `value` becomes nullable
behind a CHECK that keeps the two row shapes mutually exclusive, so an answer
always carries a value and a retraction never does (migration `0009`). The new
`retractAnswer` helper appends a tombstone: `latestAnswers` then omits that
question entirely (the kernel sees it as unanswered, so required-validation
blocks again) while `answerLedger` keeps showing the retraction, because the
audit trail must record that the answer was cleared rather than erase that it
existed. `AnswerRow` carries `retracted` and the new `isRetraction` narrows to a
retraction row, so audit and export readers branch explicitly. No row is ever
mutated or deleted: append-only (R3 / ADR-17) is untouched and no DELETE door is
widened. `AnswerValue` still admits no null and no sentinel, so rules, exports,
reporting and the compiler are unchanged.

`@roonga/qcms-ui` (patch: bug fix, no API change). The DatePicker adapter now observes a
clear. react-aria reports a date only when it becomes complete, and reports null
only when every segment is empty, so a complete date backspaced to a partial one
emitted nothing at all and the controlled value stayed at the old date. The
adapter reads the control's displayed segments at the commit moment and emits the
clear, which the host posts as a retraction. The vendored component is untouched
(ADR-22).
