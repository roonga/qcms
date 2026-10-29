---
"@roonga/qcms-db": minor
"create-qcms-app": patch
---

A scaffolded installation gets the authorised operations read model: an operations forms
query whose every field is gated by the cell that would authorise reading it elsewhere, a
stateless release review, and an access capability projection the shell can navigate by.
`operations` joins the reserved environment names, because the route root would collide
with a per-environment mount prefix.

Three query helpers for the authorised operations read model, and one widening.

`responseCountsByForm` counts submitted and still-open sessions for several forms in one
environment, in two grouped queries rather than a pair per form. `submitted` is read from
the erasure-safe `responses` view, so an erased response is not counted: erasing deletes
the submission and leaves the session shell behind, and a count taken from
`sessions.status` would keep reporting a response the respondent had removed, and would
disagree with the list the same caller can open. It authorises nothing and writes no
audit row: an aggregate is not a read of anybody's answers, and showing one is the
caller's to authorise per form and environment.

`lastReleaseAtByForm` answers when each form was last released to any environment, and
`publishedTitlesByForm` answers each named form's newest published title. Both are one
query for a whole page. The title read cannot reach an open draft, which is the point
rather than an optimisation: a caller who may be told what a form is called may not be
shown its draft.

`FormEnvironmentState` gains `releasedAt`, the timestamp of the newest release-state row
for the pair, so a reader of "version 3, open" can say when that became true without a
second read. `getFormEnvironmentState` and `environmentStatesByForm` both carry it.
