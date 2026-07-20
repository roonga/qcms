# 005 - Rules DSL schemas and dependency graph

**Stage:** 2 · **Package:** `@qcms/core` · **Depends on:** 004
**References:** `DOMAIN_SCHEMA.md` §3 · ADR-03, **ADR-16** · `ARCHITECTURE.md` §4.2

## Context

The closed, typed condition language - closed is the feature: it makes publish-time validation possible, keeps evaluation deterministic, and lets a visual builder emit the format later. This task also builds the dependency-graph machinery ADR-16 needs: the forward-pass semantics are enforced at publish, and this is where the graph analysis lives.

## Deliverables

- `Condition` recursive discriminated union on `op`, per `DOMAIN_SCHEMA.md` §3: `equals`, `notEquals`, `in` (values min 1), `gt/gte/lt/lte` (value: `Comparable`), `answered`, `contains` (value: `OptionId`), `containsAny` (values: `OptionId[]` min 1) - the containment pair valid only against `multiChoice` questions (ADR-21), `and/or` (conditions min 1), `not`. **Nesting depth capped at 8**, validated at parse with `RULE_DEPTH_EXCEEDED`.
- `VisibilityRule`: `{ ruleId, when: Condition, show: (QuestionId|StepId)[] (min 1) }`. Semantics (document clearly, replacing the mid-edit comment in `DOMAIN_SCHEMA.md`): *targets listed in any rule are conditional - hidden by default, shown when at least one targeting rule matches. Items never targeted are unconditionally visible.*
- **Graph utilities** (pure functions over a `FormDefinition`):
  - `documentOrder(form)` - flat ordered list of `(stepId, questionId)` positions.
  - `ruleReferences(rule)` - every `questionId` a condition reads (recursive).
  - `ruleTargets(rule)` - expanded targets (a `StepId` target expands to all its questions).
  - `analyzeRuleGraph(form)` - returns typed findings: `RULE_BACKWARD_TARGET` (a target at or before any referenced question in document order) and `RULE_CYCLE` (cycles in the reads→shows digraph). Used by `compileDraft` (008); exported for the admin editor's live validation (033).
- Type-compatibility checks: `gt/lt` only against `number`/`date` questions; `equals` value must match the referenced question's `AnswerValue` type; `in`/`equals` on choice questions must use declared `optionId`s; `contains`/`containsAny` only against `multiChoice` questions and only with declared `optionId`s (ADR-21) → `RULE_TYPE_MISMATCH` / `DANGLING_OPTION_REF`. (Needs resolved question definitions - export as `checkRuleTypes(form, resolveQuestion)` taking a lookup, keeping this package I/O-free.)

## Exit criteria

1. Parse/reject tests per operator, including depth-9 rejection and empty `and`/`in`/`containsAny` rejection.
2. `analyzeRuleGraph` unit tests: forward chain OK; same-position target flagged; A-shows-B-reads-B'-shows-A cycle flagged; step-target expansion correct.
3. `checkRuleTypes` tests: `gt` on boolean flagged; `equals` with wrong-typed value flagged; unknown `optionId` flagged; `contains` on a non-multiChoice question flagged.
4. `DOMAIN_SCHEMA.md` §3 updated: ADR-16 semantics stated, mid-edit comment artifact removed.

## Out of scope

Evaluation (006), integration into `compileDraft` (008).
