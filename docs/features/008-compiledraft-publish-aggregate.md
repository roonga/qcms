# 008 — compileDraft publish aggregate

**Stage:** 3 · **Package:** `@qcms/core` · **Depends on:** 005, 006 (and 004's error model)
**References:** `DOMAIN_SCHEMA.md` §4.1, §5 · ADR-01/02/14, **ADR-16, ADR-18** · Invariants I1–I3 · R1

## Context

Publish is the single true aggregate in the system. `compileDraft` either produces an immutable snapshot or a complete typed error list — atomically, nothing persisted on failure (persistence isn't even reachable from here; this is a pure function the API slice calls in 022).

## Deliverables

- `compileDraft(draft: DraftInput): PublishResult` where `DraftInput = { definition: FormDefinition, resolveQuestion: (questionId, version) => QuestionVersionRecord | undefined, publishedQuestionVersions: ... }` — the caller supplies lookups; core never does I/O (R3).
- Validation, accumulating **all** errors:
  1. Every `QuestionRef` resolves (`DANGLING_QUESTION_REF`) and references a *published* question version (`UNPUBLISHED_QUESTION_PIN`).
  2. Every rule reference/target resolves, including `optionId`s against the pinned version's options (`DANGLING_OPTION_REF`, `DANGLING_STEP_REF`).
  3. Rule graph is forward-only and acyclic via `analyzeRuleGraph` (ADR-16: `RULE_BACKWARD_TARGET`, `RULE_CYCLE`); types check via `checkRuleTypes`; depth cap enforced.
  4. `defaultLocale` completeness for every `LocalizedText` in the form *and* in every pinned question version (`LOCALE_INCOMPLETE`).
- On success: `FrozenSnapshot` — the `FormDefinition` plus resolved question definitions, deep-frozen (`Object.freeze` recursively; verify with a mutation attempt in tests), stamped with `{ semanticsVersion: SEMANTICS_VERSION, schemaVersion }`. (Compiled A2UI and its version stamps are attached by the API slice using 011's compiler — core does not import the compiler.)
- `PublishResult` uses the 004 error model; ok/err discriminated.

## Exit criteria

1. Each invariant has a fixture that violates *only* it and yields *only* its error; one fixture violating three invariants yields all three errors in one result.
2. Kitchen-sink and insurance fixtures compile; snapshots deep-frozen (mutation throws in strict mode / is a type error).
3. Determinism: same draft + lookups → structurally identical snapshot.
4. `DOMAIN_SCHEMA.md` §4.1 flowchart updated to include the ADR-16 graph checks.

## Out of scope

Persisting snapshots (013/022), A2UI compilation (011), question publish lifecycle enforcement (013/021).
