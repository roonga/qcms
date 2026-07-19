# 007 — Evaluator test corpus

**Stage:** 2 · **Package:** `@qcms/core` · **Depends on:** 006
**References:** `IMPLEMENTATION_PLAN.md` Stage 2 exit criteria

## Context

Golden files are the regression net for semantics that must never drift (I7). This corpus is separate from implementation tests: it describes *behavior* as data, survives refactors, and doubles as executable documentation. It is append-only in spirit — goldens change only with a `SEMANTICS_VERSION` bump.

## Deliverables

- `packages/core/golden/evaluator/` — scenario files: `{ form: <fixture ref>, answers: [...], expected: FlowState }`, with a small runner that loads and asserts all of them.
- Coverage matrix (at minimum one scenario each):
  - Every operator (`equals`, `notEquals`, `in`, `gt`, `gte`, `lt`, `lte`, `answered`, `contains`, `containsAny`) on every applicable question type — including multiChoice set-equality vs containment scenarios (ADR-21).
  - `and`/`or`/`not` combinations; nesting at depth 8 (the cap).
  - Step-level target show/hide; multiple rules targeting the same question (OR semantics).
  - Hidden-answer exclusion chains (A controls B, B's answer referenced by rule for C).
  - Empty answers; all answered; partial with required missing.
  - The full insurance flow as a multi-scenario sequence (each answer appended → expected FlowState after each).
  - Kitchen-sink fixture end-to-end.
- Mutation check: a script (`pnpm test:golden-drift`) that fails if any golden file's expected output differs from live evaluator output — the CI guard.
- A `CORPUS.md` explaining scenario format and the rule for changing goldens (semantics bump only).

## Exit criteria

1. Coverage matrix complete; each scenario asserted in CI.
2. Deliberately breaking a semantic in a scratch branch (e.g. treating unanswered as `true`) fails ≥1 named golden — verify once, note which, revert.
3. Corpus runner reports per-scenario failures with a readable diff.

## Out of scope

New evaluator behavior. If writing a scenario reveals a semantic gap, file an issue and stop — 006 owns semantics.
