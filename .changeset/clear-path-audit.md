---
"@qcms/ui": patch
"@qcms/db": patch
---

One meaning for one clearing gesture, across every control type (issue #98,
ADR-33). Auditing each control's clear path found the same respondent action
("I emptied this field") reaching the API three different ways: an emptied
TextField or TextArea posted an empty-string answer, a CheckboxGroup unchecked to
nothing posted an empty-array answer, and only the NumberField and DatePicker
posted the ADR-33 retraction.

`@qcms/ui` (patch: bug fix, no API change). The text and checkbox-group adapters
now report an emptied control as absence, so the host posts one retraction at that
control's ADR-31 commit moment, exactly as the number and date controls already
did. `""` and `[]` are legal `AnswerValue`s, so they *satisfied* `required` while
holding nothing; and where a constraint rejected the empty value (a
`minLength`/`pattern` shortText, a `minSelected: 1` multiChoice - the usual shapes
for a required question) the empty post was rejected 422, so the respondent read
"not valid" while the server quietly kept the previous answer and Continue
advanced on it. Nothing in the UI can distinguish "emptied" from "never answered",
so the empty value was never the respondent's statement; an author who wants "none
of these" to be sayable gives the question that option, which is a real OptionId.
This also aligns the JavaScript path with the no-JS submit path, which already
decoded a blank field and an empty checkbox set as absent. RadioGroup and Select
have no clear gesture at all (a chosen radio or option cannot be deselected), and
the Select adapter now normalizes the empty selection react-aria types as possible
to the same absence rather than letting a `null` travel as an answer. The vendored
components are untouched (ADR-22).

`@qcms/db` (patch: return type narrowed, no behavior change). `retractAnswer`
returns `RetractionRow` instead of `AnswerRow`. It can only ever insert a
tombstone, so the narrower type carries that invariant to callers rather than
making each one re-derive it through `isRetraction`.
