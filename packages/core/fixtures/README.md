# @qcms/core fixtures

The canonical fixture set for the domain kernel. **Later tasks reference these
files — never fork them.** Additions are fine (they are how the set grows, e.g.
task 012 adds a constraints-heavy and a deep-nesting-rules form); renaming,
re-keying IDs, or changing existing semantics is a breaking change to every
consumer listed below.

Fixtures are plain JSON read by tests (and by dev seeding, task 032's
`pnpm qcms:seed-fixtures`). Shipped `@qcms/core` code never reads them — no
I/O in the kernel (R3).

## Layout

```
fixtures/
  questions/valid/     one parseable QuestionDefinition per question type (task 003)
  questions/invalid/   one failing definition per parse refinement (task 003)
  forms/valid/         parseable FormDefinitions (task 004)
  forms/invalid/       one failing form per parse-level refinement (task 004)
  submissions/         golden LockedSubmission content hashes (task 009)
```

### Invalid-fixture format

Every file under an `invalid/` directory wraps the broken payload with its
assertion, and the fixture-driven tests check exactly that:

```json
{
  "description": "why this is invalid",
  "expected": { "code": "TYPED_ERROR_CODE", "path": ["where", 0, "it", "fails"] },
  "definition": { "...the broken payload..." }
}
```

## Questions (`questions/valid/`, task 003)

One fixture per question type — together they seed the kitchen-sink form.

| File | Type | questionId | Notes |
|---|---|---|---|
| `short-text.json` | `shortText` | `q_full_name` | length + safe-pattern constraints |
| `long-text.json` | `longText` | `q_medical_history` | |
| `number.json` | `number` | `q_cigs_daily` | the insurance follow-up |
| `date.json` | `date` | `q_dob` | canonical `YYYY-MM-DD` min/max |
| `boolean.json` | `boolean` | `q_smoker` | the insurance branch question |
| `single-choice.json` | `singleChoice` | `q_coverage_level` | carries `opt_none` (optionId scoping, R6) |
| `multi-choice.json` | `multiChoice` | `q_preexisting_conditions` | also carries `opt_none` — optionIds are question-scoped |

`questions/invalid/` holds one fixture per parse refinement of
`QuestionDefinition` (min/max ordering, selection bounds, duplicate optionIds,
empty option labels, unsafe/uncompilable patterns, empty option lists).

## Forms (`forms/valid/`, task 004)

| File | formId | What it is |
|---|---|---|
| `kitchen-sink.json` | `frm_kitchen_sink` | **The canonical reference form** (tasks 007, 011, 012, 028, 030, 038): pins every question fixture above (all seven types), 3 steps, 2 rules (`equals` branch + `containsAny` branch) |
| `insurance.json` | `frm_life_signup` | The motivating flow from `DOMAIN_SCHEMA.md` §6: `q_smoker@2` → rule `rul_smoker_followup` shows `q_cigs_daily@1` |
| `minimal.json` | `frm_minimal` | Smallest valid form: one step, one question, empty rules array |

Form fixtures only pin questionIds that exist in `questions/valid/` (tested),
so publish-time resolution against the question fixtures (task 008) works out
of the box. Since task 005 rule entries are validated by the real DSL schema
at parse; regression tests (`visibility-rule.test.ts`, `rule-graph.test.ts`)
assert that `kitchen-sink.json` and `insurance.json` rules parse under
`VisibilityRule`, pass `analyzeRuleGraph` clean, and type-check against the
question fixtures.

## Forms (`forms/invalid/`, task 004)

One per parse-level refinement of `FormDefinition`:

| File | Asserted code |
|---|---|
| `duplicate-step-id.json` | `DUPLICATE_STEP_ID` |
| `duplicate-question-across-steps.json` | `DUPLICATE_QUESTION_IN_FORM` |
| `duplicate-question-same-step.json` | `DUPLICATE_QUESTION_IN_FORM` |
| `missing-rules.json` | `INVALID_FORM_DEFINITION` (`rules` must be present, even if empty) |
| `rule-depth-exceeded.json` | `RULE_DEPTH_EXCEEDED` (condition nested past the cap of 8 — task 005) |
| `no-steps.json` | `INVALID_FORM_DEFINITION` (`steps` min 1) |
| `step-no-items.json` | `INVALID_FORM_DEFINITION` (`items` min 1) |

Publish-time failures (dangling refs, unpublished pins, locale gaps, rule
graph violations — the `PublishError` codes) are **not** fixture-driven here:
they need a question repository to resolve against and belong to task 008's
`compileDraft` tests.

## Submissions (`submissions/`, task 009)

| File | What it pins |
|---|---|
| `insurance-golden.json` | The `contentHash` of the DOMAIN_SCHEMA §6 complete insurance submission (`q_smoker=true, q_cigs_daily=20`). Guards the canonical-JSON hashing contract across machines and Node versions — a mismatch is canonicalization drift, never re-record casually. |
