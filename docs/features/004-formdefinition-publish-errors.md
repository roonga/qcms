# 004 - FormDefinition and typed publish errors

**Stage:** 1 · **Package:** `@qcms/core` · **Depends on:** 002, 003
**References:** `DOMAIN_SCHEMA.md` §2.3 · ADR-02, ADR-11

## Context

A form is ordered steps of pinned question references plus visibility rules. Pins are `{questionId, version}` - drafts may float, snapshots never do. The typed error model defined here is the contract `compileDraft` (008) returns and the admin UI (034) renders verbatim.

## Deliverables

- `QuestionRef`: `{ questionId, version: positive int }`.
- `Step`: `{ stepId, title: LocalizedText, items: QuestionRef[] (min 1) }`.
- `FormDefinition`: `{ formId, defaultLocale, title, steps (min 1), rules: VisibilityRule[] }` - parse-level refinements only: unique `stepId`s, unique `questionId` across all steps (a question appears at most once per form), rules array present (content validated in 005/008).
- **`PublishError` model** - discriminated union with `code`, human `message`, and a structured `path` (e.g. `{ step: "stp_history", question: "q_at_fault_accident" }`). Codes at minimum: `DANGLING_QUESTION_REF`, `DANGLING_OPTION_REF`, `DANGLING_STEP_REF`, `UNPUBLISHED_QUESTION_PIN`, `LOCALE_INCOMPLETE`, `RULE_BACKWARD_TARGET`, `RULE_CYCLE`, `RULE_DEPTH_EXCEEDED`, `RULE_TYPE_MISMATCH`, `DUPLICATE_QUESTION_IN_FORM`. `PublishResult = ok(FrozenSnapshot) | err(PublishError[])` - always **all** errors, never first-only.
- **Fixtures** in `packages/core/fixtures/forms/`:
  - `kitchen-sink.json` - every question type, ≥3 steps, at least one rule (the canonical reference form used by tasks 007, 011, 012, 028, 030, 038).
  - `insurance.json` - the motivating flow from `DOMAIN_SCHEMA.md` §6 (`q_at_fault_accident` → `q_accident_count`).
  - `minimal.json` - one step, one question.
  - Invalid fixtures for each parse-level refinement.

## Exit criteria

1. All three valid fixtures parse; invalid fixtures fail with asserted codes/paths.
2. `PublishError` codes are exhaustively switch-checked (compile-time `never`).
3. Fixtures documented in `packages/core/fixtures/README.md` - later tasks reference, never fork, them.

## Out of scope

Rule content validation (005), publish invariant checking (008), the frozen-snapshot implementation (008).
