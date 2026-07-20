# 002 - Core IDs, LocalizedText, canonical AnswerValue

**Stage:** 1 · **Package:** `@qcms/core` · **Depends on:** 001
**References:** `DOMAIN_SCHEMA.md` §2 · `ARCHITECTURE.md` §4.1 · ADR-11 · R6

## Context

These are the atoms every other schema builds on. The canonical `AnswerValue` encoding is decided **here** - before the evaluator exists - because `gt/lt` comparisons, storage, and exports all depend on it and it freezes into snapshots (review resolution: originally deferred too late).

## Deliverables

In `packages/core/src/`:

- **Branded ID types** (Zod `.brand()`): `QuestionId` (`q_[a-z0-9_]+`), `FormId` (`frm_`), `StepId` (`stp_`), `OptionId` (`opt_`), `RuleId` (`rul_`), `SessionId` (`ses_`), plus `LocaleCode` (BCP-47 subset: `xx` or `xx-XX`). Export type + schema + `parse`/`is` helpers for each.
- **`LocalizedText`**: `z.record(LocaleCode, z.string().min(1))`, plus `resolveText(text, locale, defaultLocale)` (exact → default → typed error) and `isCompleteFor(text, locale)`.
- **Canonical `AnswerValue`** - one discriminated encoding per question type, documented in code and in `DOMAIN_SCHEMA.md`:
  - `shortText`/`longText`: NFC-normalized string (normalize on parse).
  - `number`: finite IEEE double (`z.number().finite()`); `integer` constraint checked at validation, not encoding.
  - `date`: timezone-less ISO `YYYY-MM-DD` string, validated as a real calendar date (reject `2026-02-30`). No time, no offset - respondent-local dates by design.
  - `boolean`: JSON boolean.
  - `singleChoice`: `OptionId`. `multiChoice`: `OptionId[]`, deduplicated, order-preserving.
  - Export `AnswerValue` union + `Comparable` (number | date string) for the DSL's ordered operators; define date comparison as lexicographic on the canonical encoding (correct for ISO dates) - implement and export `compareValues`.
  - Implement and export `valuesEqual(a, b)` - canonical equality used by `equals`/`notEquals`/`in` (ADR-21): strict equality on scalars, **set equality** for `multiChoice` arrays (order- and duplicate-insensitive).
- **Typed error primitives**: `QcmsError` base shape `{ code, message, path? }` used by all later error models.

## Implementation notes

- Zod schemas are the source of truth; TypeScript types are inferred, never hand-written (`z.infer`).
- No I/O, no dependencies beyond `zod`. This package must stay pure forever (R3).
- .NET mapping: branded types ≈ strongly-typed IDs (like `record struct QuestionId(string Value)`); Zod ≈ FluentValidation + the type system in one.

## Exit criteria

1. Round-trip tests: every valid encoding parses and re-serializes identically.
2. Rejection tests with asserted error codes: bad ID prefixes, empty locale strings, `2026-02-30`, `NaN`/`Infinity`, non-NFC input normalized (not rejected), duplicate `multiChoice` options deduplicated.
3. `compareValues` property test: agrees with `Date` comparison for 1000 random valid date pairs; agrees with numeric comparison for numbers; rejects cross-type comparison with a typed error.
4. `AnswerValue` section added to `DOMAIN_SCHEMA.md` (resolves its open item on canonical encoding).
5. `valuesEqual` tests: multiChoice order-insensitivity (`[a,b]` equals `[b,a]`) and dedupe-insensitivity; scalar strictness; cross-type values never equal.

## Out of scope

Question definitions (003), any validation against constraints (009), persistence of any kind.
