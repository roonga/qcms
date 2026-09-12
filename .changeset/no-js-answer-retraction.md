---
"@roonga/qcms-ui": patch
"create-qcms-app": patch
---

A respondent with JavaScript disabled can now clear an answer they already gave
(issue #127, Code Owner ruling 2026-09-02).

A native form cannot say "I emptied this". It posts an emptied text box exactly as it
posts a never-touched one, and posts an all-unchecked checkbox group as nothing at all.
The strict BFF holds no answer state and may not ask the API for any (R2), so it read
both as "never answered" and dropped them. The scripted path had retracted an emptied
control since issue #98, so the same respondent gesture meant "cleared" with scripting
on and "no change" with it off: a no-JS respondent who emptied a previously answered
required field submitted with the stale answer still standing, and any rule reading it
evaluated on a value they believed they had removed.

`@roonga/qcms-ui` (patch: additive, and inert outside native-submit mode). In
native-submit mode each answer field now carries a second hidden companion,
`__qa__<questionId>`, emitted only for a question that currently holds an answer -
the same `values` the control is seeded from, so this makes an already
respondent-visible signal machine-readable rather than disclosing anything new.
`NATIVE_FIELD_ANSWERED_PREFIX` and `NATIVE_FIELD_ANSWERED_VALUE` are exported beside
the existing kind-tag prefix. The controlled (scripted) render is unchanged, markers
included: it does not submit the native form. The marker is `type="hidden"`, so it is
not visible, not focusable and carries no accessible name.

`create-qcms-app` (patch: the scaffolded portal's own copy). The scaffolded whole-step
BFF decoder reads a marked field that arrives empty or absent as an ADR-33 retraction
and posts the same `null` body, to the same answer endpoint, that the scripted path
posts for the same gesture - so one respondent gesture reaches one ledger call down
either transport. An unmarked empty field stays silence, so nothing is tombstoned for a
question nobody answered, and partial submits are unaffected because the API's submit
semantics did not change. The decoder now walks the renderer's kind tags rather than
the posted values, which is what lets an emptied checkbox group be seen at all: it
contributes no entry of its own.

Out of scope, by construction rather than by choice: a NumberField and a DatePicker
carry their form value in a hidden input that JavaScript syncs, so with scripting off
the seeded answer is what serializes and neither control can be emptied at all. That is
issue #18, phase 4. A marked number or date therefore never arrives empty and can never
retract by accident.
