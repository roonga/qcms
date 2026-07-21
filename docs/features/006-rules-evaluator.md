# 006 - Rules evaluator (forward pass)

**Stage:** 2 · **Package:** `@qcms/core` · **Depends on:** 005
**References:** **ADR-16** · `ARCHITECTURE.md` §4.2 · Invariants I6, I7

## Context

The heart of the product. `evaluateRules(snapshot, answers) → FlowState` is a pure, total, deterministic function whose semantics are versioned with the snapshot: same inputs, same output, forever. ADR-16 fixed the semantics as a **single forward pass in document order** - the publish-time graph validation (005/008) guarantees rules only point forward, so one pass is sufficient and no fixpoint question arises.

## Deliverables

- `FlowState`: `{ visible: Array<{stepId, questionId}>, visibleSteps: StepId[], currentStep: StepId | null, answeredRequired: QuestionId[], missingRequired: QuestionId[], complete: boolean }` (exact shape may be refined; document whatever ships).
- `evaluateRules(snapshot: FrozenSnapshot | FormDefinition, answers: AnswerMap): Result<FlowState, EvalError>` where `AnswerMap = Map<QuestionId, AnswerValue>` (the *current* answers - latest-per-question resolution happens in storage, not here).
- **Semantics (implement exactly; these freeze):**
  1. Walk items in document order. Untargeted items are visible. A targeted item is visible iff at least one rule targeting it evaluates true *at that point in the walk*.
  2. Condition evaluation: references to unanswered questions are `false`, except `answered` which is the explicit existence test. References to questions currently *hidden* are treated as unanswered (their answers are excluded) - well-defined because hidden status of any referenced question was settled earlier in the walk (forward-only guarantee).
  3. `equals`/`notEquals`/`in` compare via `valuesEqual` (002 - set equality for `multiChoice`, ADR-21); `contains`/`containsAny` test `optionId` membership in the `multiChoice` answer; `gt/gte/lt/lte` use `compareValues`; comparing incompatible types cannot happen post-publish but returns a typed `EvalError` on unvalidated input rather than throwing.
  4. A hidden step contributes no visible questions regardless of per-question rules.
  5. `currentStep` = first visible step containing a visible unanswered required question, else first with any visible unanswered question, else `null`; `complete` = no visible required question unanswered.
- Totality: never throws on schema-valid input; malformed input → typed error.
- Export `SEMANTICS_VERSION = 1` - stamped into snapshots by 008; any future change to the numbered semantics above increments it.

## Exit criteria

1. Property tests (fast-check): determinism (same inputs twice → deep-equal output); totality over generated valid forms/answers; answer-order independence (AnswerMap is a map, not a ledger).
2. Unit tests for each numbered semantic, including: hidden question's answer excluded from a downstream condition; `answered` vs `equals` on unanswered; step-level vs question-level targeting; `contains` vs `equals` on a multiChoice answer with a subset selected (ADR-21).
3. Insurance fixture: `q_at_fault_accident=true` shows `q_accident_count`; changing to `false` hides it and its stale answer does not affect any later condition.
4. Semantics documented in `DOMAIN_SCHEMA.md` with the worked example updated.

## Out of scope

Golden corpus breadth (007), publish validation (008), submission locking (009).
