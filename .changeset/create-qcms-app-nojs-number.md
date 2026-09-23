---
"create-qcms-app": patch
---

Regenerate the scaffolded portal's whole-step decoder documentation for the no-JS number
question (issue #18).

The templates are generated from `apps/portal`, so this is the scaffolded half of the same
change. Only the decoder's docblock moves: `lib/server/step-form.ts` used to record the
NumberField as out of scope for the `__qa__` clearing marker, because react-aria carried a
number's form value in a JavaScript-synced hidden input that a respondent with scripting
off could never empty. `@roonga/qcms-ui` now renders a real `<input type="number">` on
that path, so an emptied number arrives empty beside its marker and decodes to the same
`null` retraction as any other cleared field. No decoding rule changed, which is the point
worth recording: the rule was always about the post rather than about the control.
