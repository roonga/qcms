# 003 — Question-type definitions

**Stage:** 1 · **Package:** `@qcms/core` · **Depends on:** 002
**References:** `DOMAIN_SCHEMA.md` §2.2, §4.2 · ADR-02 · R6

## Context

Questions are first-class versioned entities: `questionId` is identity (stable forever, never reused — R6), `version` is content. The seven-type set is closed per core release; adding a type is a versioned core change, never an `ALTER TABLE`.

## Deliverables

- `QuestionBase`: `{ questionId, label: LocalizedText, help?: LocalizedText, required: boolean (default false) }`.
- `QuestionDefinition` discriminated union on `type`, exactly as `DOMAIN_SCHEMA.md` §2.2 (declare `ChoiceOption` **before** the union — the doc has a TDZ ordering bug; fix it here and in the doc):
  - `shortText` — constraints `{ minLength?, maxLength?, pattern? }` (pattern is RE2-safe: validate compilability at parse, reject catastrophic constructs; document the supported subset).
  - `longText` — `{ maxLength? }`.
  - `number` — `{ min?, max?, integer (default false) }`.
  - `date` — `{ min?: ISODate, max?: ISODate }`.
  - `boolean` — no constraints.
  - `singleChoice` / `multiChoice` — `options: ChoiceOption[]` (min 1, unique `optionId`s enforced); multiChoice adds `{ minSelected?, maxSelected? }`.
- Cross-field refinements with typed errors: `minLength ≤ maxLength`, `min ≤ max`, `minSelected ≤ maxSelected ≤ options.length`, option labels non-empty for at least one locale.
- `QuestionVersionRecord`: `{ questionId, version: positive int, definition }` — the shape the library stores; immutability is enforced by storage + publish, not here.
- Fixtures in `packages/core/fixtures/questions/`: one valid instance of every type (these seed the kitchen-sink form) including `q_smoker` (boolean) and `q_cigs_daily` (number) for the insurance flow; a set of invalid definitions, one per refinement.

## Exit criteria

1. Every fixture parses; every invalid fixture fails with the asserted error code and path.
2. Discriminated-union exhaustiveness: a compile-time `never` check over `type` (adding a type without handling it breaks the build).
3. Duplicate `optionId` within a question rejected; duplicate across questions allowed.
4. `DOMAIN_SCHEMA.md` §2.2 updated: `ChoiceOption` declaration order fixed; pattern-subset documented.

## Out of scope

Answer validation against these constraints (009), question storage (013), authoring API (021).
