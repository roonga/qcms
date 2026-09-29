---
"@roonga/qcms-core": minor
---

Add the repeating group to the kernel (task 071, ADR-42; ADR-03 and ADR-16 as
amended 2026-09-30; SEC-16).

QCMS could not ask the same question twice, because an answer was keyed by a
bare `questionId` everywhere. A **repeating group** closes that with one new
concept: a named, ordered set of pinned question refs inside a step's item list,
answered once per **instance**. A looping question is a group of one; a looping
step and a table are presentations of the same group. No question type is added
and `AnswerValue` is unchanged.

- `GroupId` (`grp_`, form-scoped) and `InstanceId` (`ins_`, session-scoped), with
  `AnswerKey` and the `/` separator. `AnswerMap` widens from
  `ReadonlyMap<QuestionId, ...>` to `ReadonlyMap<AnswerKey, ...>`, which every
  existing caller satisfies because `QuestionId` is a member of `AnswerKey`.
- `RepeatGroup`, `RepeatCount` and a widened `Step.items`, the union
  discriminable by disjoint required keys with no `kind` tag, so every form
  definition that parses today parses unchanged. `max` is required at publish on
  `fromAnswer` and on `open`; a `fixed` count is its own bound.
- `evaluateRules` gains an optional fourth parameter, the already-derived live
  roster in roster order. Omitted, it is the empty map. A rule whose `show`
  target sits inside a group is evaluated once per live instance, with in-group
  references resolving to that instance.
- Three operators, taking the closed set from thirteen to sixteen:
  `anyInstance`, `everyInstance` and `instanceCount`. **`everyInstance` over a
  group with no live instance is FALSE by decision**, so it is not equivalent to
  `not(anyInstance(not c))` over an empty group.
- Publish gains `DUPLICATE_GROUP_ID`, `REPEAT_NESTING_NOT_ALLOWED`,
  `REPEAT_MAX_MISSING`, `REPEAT_MIN_ABOVE_MAX`, `REPEAT_COUNT_BACKWARD_REF`,
  `REPEAT_COUNT_NOT_A_NUMBER`, `INSTANCE_LABEL_PLACEHOLDER_UNKNOWN`,
  `RULE_TARGETS_SPAN_SCOPES` and `REPEAT_EVALUATION_BUDGET_EXCEEDED`, the last
  above a fixed `REPEAT_EVALUATION_BUDGET` of 10,000 instance pairs. That is a
  cost bound on one rule shape and not an instance ceiling: nothing in core caps
  a group's `max`.
- `prepareSubmission` takes the roster too, reports `MISSING_REQUIRED` per
  `(instance, question)` and adds `REPEAT_COUNT_OUT_OF_RANGE`.
- `FlowState` gains four optional fields, `visibleStepViews`,
  `missingRequiredInstances`, `answeredRequiredInstances` and `rosters`, each
  **absent entirely** for a form with no group. `SNAPSHOT_SCHEMA_VERSION` moves
  to 2.

**`SEMANTICS_VERSION` stays 1**, and that is load-bearing rather than tidy: the
evaluator implements one version at a time and refuses any other stamp, so a
bump would make every published snapshot fail at serve, answer and submit rather
than preserve it. Every committed golden evaluator scenario passes with no
`expected` block edited, and eight scenarios are appended beside them.
