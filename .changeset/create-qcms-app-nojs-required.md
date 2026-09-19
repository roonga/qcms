---
"create-qcms-app": minor
---

Scaffold the portal's no-JS missing-required reporting, so an adopter's respondents are
told which required question they left blank instead of getting a silent reload (issue
#920).

The templates are generated from `apps/portal`, so this is the scaffolded half of the
same change. The whole-step BFF route now reads the API's own
`flowState.missingRequired`, narrows it to the questions the posted form asked and to
those not already carrying a 422, and carries it in the re-render context; the no-JS step
view draws them through the same `lib/error-summary.ts` composition the hydrated flow
already uses for its summary, plus each field's own error slot, with the answers the API
accepted still in place.

No validation authority moves into the scaffolded BFF. `required` stays the kernel's
judgement, served by the API, which continues to refuse an empty value outright and to
refuse a submission with a visible required gap; what changes is only whether a
respondent with scripting disabled ever learns about it.
