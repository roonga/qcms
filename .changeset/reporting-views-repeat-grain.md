---
"@roonga/qcms-db": minor
---

Teach the reporting views about repeating groups, and stop them losing answers (task 075,
ADR-42, Q18 ruled 2026-09-29).

`reporting.responses.answers` was built with
`jsonb_object_agg(item ->> 'questionId', item -> 'value')`. Two locked answers for one
`questionId` is exactly what a repeating group produces, and `jsonb_object_agg` **silently
keeps one of them** - no error and no warning. Migration `0025` closes that:

- Every answer **outside** a group keeps its `questionId -> value` entry, so a form with no
  repeating group produces a **byte-identical** `answers` object. The change is additive in
  fact and not only in principle, and an integration test asserts the stored JSONB's bytes.
- Every answer **inside** a group is carried under **one key per `groupId`**, holding an
  ordered array of `{"instance_id": "ins_…", "<questionId>": value, …}`. Array order is roster
  order, the order the submission froze.
- **`reporting.answers_flat` gains a nullable `instance_id`**, appended to its column list, so
  its grain becomes `(session, questionId, instanceId)`. A consumer selecting explicit columns
  is unaffected and a consumer selecting `*` keeps every column in the position it had.
  `GROUP BY session_id, question_id` without `instance_id` now aggregates across instances.

The view DDL is now **generated** rather than a literal migration body:
`reportingViewStatements()` and `reportingViewColumns` are exported from the package, take
their schema names as arguments, and are what migration `0025` and the drift test both read.
That is for ADR-40, which makes the view set per environment (`reporting_<env>`), with a set
per workspace after task 068: the same DDL has to be creatable more than once under more than
one name, and a copy is what drifts.

`docs/reporting-view.md` carries the new shape, the example and the stability reasoning.
