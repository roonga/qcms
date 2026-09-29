# 071 - The repeating group in the kernel

**Stage:** 8c (launch scope) · **Apps/packages:** `@roonga/qcms-core`, `apps/admin` (the parallel operator list only) · **Depends on:** nothing in flight
**References:** ADR-42 (the decision) · ADR-03 as amended 2026-09-30 (three operators, `everyInstance` false over an empty group, the two publish refusals) · ADR-16 as amended 2026-09-30 (the forward pass over a span, the cost bound, `SEMANTICS_VERSION` held at 1) · SEC-16 (per-form bounds) · `plan/repeating-groups-and-table-input.md` sections 2 to 3, and Q2, Q4, Q5, Q6, Q7, Q8, Q12, Q13, Q14, Q15 · R3 · R6 · I6 · I7 · I9 · I10

## Context

QCMS cannot ask the same question twice: `FormDefinition`'s own refinement (`DUPLICATE_QUESTION_IN_FORM`) refuses a `questionId` pinned more than once, because an answer is keyed by a bare `questionId` in the evaluator, in the `answers` table's grain and in `reporting.answers_flat`. ADR-42 adds one concept to close that, the **repeating group**: a named, ordered set of pinned question refs inside a step's item list, answered once per **instance**.

This task is the kernel half and nothing else. It is the first of the seven and everything else waits on it, including part of the admin, because `apps/admin/lib/forms/condition.ts` is tied to the `Condition` union by a type-only import and does not typecheck once core gains an operator.

**The absolute constraint is additivity.** `SEMANTICS_VERSION` stays 1, and that is load-bearing rather than tidy: the evaluator implements one version at a time and refuses any other stamp, so a bump would make every published snapshot fail at serve, answer and submit rather than preserve it. A form with no repeating group must evaluate byte-identically, and no committed golden `expected` block may be edited.

## Deliverables

- **`GroupId` and `InstanceId` branded ids**, `grp_` form-scoped and `ins_` session-scoped. The instance id is **never a label**: it may appear in a key, and in no heading, legend, label, message or caption.
- **`RepeatGroup`, `RepeatCount` and the widened `Step.items`**, the union discriminable by disjoint required keys with no `kind` tag, so every form definition that parses today parses unchanged. `max` is **required** on `fromAnswer` and on `open`; a `fixed` count is its own bound and carries no `max`.
- **`AnswerKey` and the widened `AnswerMap`**: `questionId` outside a group, `instanceId/questionId` inside one, separator `/`. Every existing call site must still compile, because `QuestionId` is a member of `AnswerKey`.
- **The optional fourth `rosters` parameter on `evaluateRules`**, receiving the **already-derived live roster** in roster order. The evaluator does not derive liveness and does not read a count answer to do so; that derivation is 072's and 073's, and this task's contract is that the map it is handed is live and ordered.
- **The per-instance forward pass**: a rule whose `show` target is inside group G is evaluated once per live instance, with in-group references resolving to that instance.
- **Three new operators**, `anyInstance`, `everyInstance` and `instanceCount`, branching in **`checkCondition`** and **`collectReferences`** (`rule-graph.ts`) and **`evalCondition`** (`evaluate-rules.ts`). Not `checkValue`, which switches on `question.type`. `collectReferences` is the one that matters most: its default branch reads `condition.questionId`, which none of the three group nodes carries, and it is what `analyzeRuleGraph` and the cycle graph read, so forward-only rule 2 does not apply at all until it knows about them.
- **`everyInstance` over an empty roster short-circuits to FALSE**, as a base case before the per-instance walk and never as a fold with a true identity. It is therefore **not** equivalent to `not(anyInstance(not c))` on an empty group, and nothing in this task may implement one as a rewrite of the other.
- **`conditionDepth` recursing into both nested-condition operators**, with `CONDITION_MAX_DEPTH` unchanged at 8.
- **`documentOrder` expanding a group into a contiguous span**, and `analyzeRuleGraph` applying the forward-only rule to the span rather than to a position.
- **The publish codes this task introduces**, all in the existing `PublishError` union and all reported alongside the others rather than short-circuiting: `DUPLICATE_GROUP_ID`, `REPEAT_COUNT_BACKWARD_REF`, `REPEAT_COUNT_NOT_A_NUMBER`, `REPEAT_NESTING_NOT_ALLOWED`, `REPEAT_MAX_MISSING`, `REPEAT_MIN_ABOVE_MAX`, `INSTANCE_LABEL_PLACEHOLDER_UNKNOWN`, `RULE_TARGETS_SPAN_SCOPES` and `REPEAT_EVALUATION_BUDGET_EXCEEDED`. There is deliberately **no** `REPEAT_MAX_ABOVE_CEILING`.
- **`RULE_TARGETS_SPAN_SCOPES`**: `VisibilityRule.show` is an array, so one rule listing a target inside a group and a target outside it is both per-instance and whole-form. Every `show` target of one rule shares one scope, and a mixed list is refused, naming both scopes.
- **`REPEAT_EVALUATION_BUDGET` and its refusal**: a rule targeting inside group H whose condition applies a whole-group operator over another group G is refused when `max_H x max_G` exceeds the constant. **It is a cost bound and not an instance ceiling**; it caps no group's `max`, and two large groups with no cross-group rule between them publish. The plan proposes `10_000` with its reasoning; confirm the value with the Code Owner before landing it, and put the reasoning in the constant's docblock rather than only in the commit.
- **`REPEAT_COUNT_OUT_OF_RANGE`** in `prepareSubmission`, and `MISSING_REQUIRED` reported per `(instance, question)`.
- **The optional `FlowState` fields** of plan section 3.5: `visibleStepViews`, `missingRequiredInstances`, `answeredRequiredInstances`, `rosters`, each **absent entirely** for a form with no group. The existing six fields keep their exact shapes and contents.
- **`SNAPSHOT_SCHEMA_VERSION` to 2.** `SEMANTICS_VERSION` stays 1.
- **Appended golden evaluator scenarios and their corpus-local forms**, including the `everyInstance` empty-group case and the removed-instance exclusion. No existing `expected` block is edited.
- **The admin's parallel operator list in `apps/admin/lib/forms/condition.ts`, in this PR.** Nothing else in the admin moves here; 074 owns the rest.
- **A changeset** for `@roonga/qcms-core` as a minor.

## Exit criteria

Acceptance cases **1, 2, 3 and 6 to 21** of `plan/repeating-groups-and-table-input.md` section 11. This task owns those and no others. Plus:

1. No `expected` block under `packages/core/golden/evaluator/` is modified, asserted by `check:golden-append-only` rather than by review.
2. `SEMANTICS_VERSION` is still 1, asserted by the constant and by case 1 passing.
3. The hand-spelled operator list in `packages/core/src/visibility-rule.test.ts` names **sixteen** operators, edited deliberately, and the admin's parallel list matches.
4. The `everyInstance` empty-group reading is pinned by case 13, which also asserts that `not(anyInstance(not c))` is **true** over the same empty group, so the non-equivalence is a test rather than a paragraph.
5. `REPEAT_EVALUATION_BUDGET`'s refusal is proved by case 16 in both directions, including that two groups above the budget with **no** cross-group rule still publish.
6. `pnpm verify` green.

## Files and areas

`packages/core/src/`: `form-definition.ts`, `step.ts`, `visibility-rule.ts`, `visibility-rule.test.ts`, `rule-graph.ts`, `evaluate-rules.ts`, `validate-answer.ts` (unchanged in behaviour, asserted), `prepare-submission.ts`, `publish-error.ts`, the branded-id module, and the constants module. `packages/core/golden/evaluator/`: new scenario and form files only. `apps/admin/lib/forms/condition.ts`. One changeset.

## Gates

`pnpm verify`. No browser gate: nothing in `apps/portal`, `apps/admin` UI or `@roonga/qcms-ui` renders differently from this task. No Docker-backed gate. `check:golden-append-only` runs inside `check:all` and is the assertion behind exit criterion 1.

## Out of scope (binding)

Any instance ceiling, per group or per session: the ruling of 2026-09-30 removed both, and reintroducing one as a constant would be reversing a decision. The database (072). Any rendering, the compiler's node, the portal, the batch endpoint and issue #968 (073). The admin beyond the parallel operator list (074). Export, reporting and the webhook payload (075). Nesting a group in a group: refused at parse, and lifting the cap is a different piece of work. Cross-instance rule references and instance reordering: out of scope for the whole feature, per plan section 9.

## Notes for the executor

**`collectReferences` is the function this task is most likely to miss**, and the failure is silent rather than loud: forward-only rule 2 simply does not apply to a group operator, so a rule that should be refused at publish is accepted and the cycle graph is wrong. Write the test for rule 2 over a span before writing the operator.

**The parallel arrays in `FlowState` are deliberate and ugly**, and the reason is in ADR-16's amendment: the originals cannot widen without a `SEMANTICS_VERSION` bump that cannot be taken. Do not tidy them, and do not add a compatibility shim that makes them look like one field. Collapsing them is the first job of multi-version evaluation, which is somebody else's task.

**The budget constant is the one number in this task that is a proposal.** Confirm it before landing rather than after, because a constant is cheap to choose and expensive to move once a form has published against it.
