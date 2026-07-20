# Golden evaluator corpus

The regression net for the rules evaluator's frozen semantics (task 007,
ADR-16, invariant I7). Each scenario describes *behavior as data*: a form, a
set of answers, and the exact `FlowState` the evaluator must produce - under
`SEMANTICS_VERSION = 1` - forever. The corpus survives refactors, doubles as
executable documentation of DOMAIN_SCHEMA §3, and is append-only in spirit.

## The rule for changing goldens

**A committed `expected` block changes only together with a
`SEMANTICS_VERSION` bump** (and the ADR that justifies it). If an evaluator
change makes any scenario fail, that change altered the frozen semantics:
either revert it, or treat it as a new semantics version - never "fix the
golden" to match new behavior. Adding *new* scenarios (or new corpus forms and
questions for them) is always welcome and is how the corpus grows.

CI enforces drift two ways with the same runner
(`packages/core/src/golden-corpus.test.ts`):

- `pnpm test` - the corpus is part of the `@qcms/core` suite;
- `pnpm test:golden-drift` (root) - runs only the corpus, as the named guard:
  it fails if any golden's `expected` differs from live evaluator output.

Failures report the scenario file by name with a structural diff of the two
FlowStates.

## Layout

```
golden/evaluator/
  CORPUS.md          this file
  questions/         corpus-local QuestionDefinitions (the q_gate_* rule targets)
  forms/             corpus-local FormDefinitions (operator/step/chain shapes)
  scenarios/         the golden scenario files - one scenario per file
```

Corpus forms pin questions from `fixtures/questions/valid/` (the canonical
seven, one per type) plus the corpus-local gates; the fixture forms
(`kitchen-sink`, `insurance`, `minimal`) are referenced directly and never
forked. Every referenced form must be publish-shaped - the runner asserts
`analyzeRuleGraph` and `checkRuleTypes` come back clean.

## Scenario format

```json
{
  "description": "what this scenario pins down, in one sentence",
  "form": "golden/evaluator/forms/ops-equals.json",
  "answers": [{ "questionId": "q_smoker", "value": true }],
  "expected": {
    "visible": [{ "stepId": "stp_src", "questionId": "q_smoker" }],
    "visibleSteps": ["stp_src"],
    "currentStep": null,
    "answeredRequired": ["q_smoker"],
    "missingRequired": [],
    "complete": true
  }
}
```

- `form` - path relative to `packages/core/`: either a canonical fixture
  (`fixtures/forms/valid/...`) or a corpus form (`golden/evaluator/forms/...`).
- `answers` - the *raw* authored values; the runner hands them to the
  evaluator uncanonicalized, so NFC normalization and multiChoice
  deduplication stay part of the asserted surface. Each `questionId` may
  appear once.
- `expected` - the full `FlowState`, all arrays in document order.

## Coverage matrix

| Matrix cell | Form(s) | Scenario file(s) |
| --- | --- | --- |
| `equals` on all 7 types; multiChoice set equality vs superset (ADR-21) | `ops-equals` | `equals-all-types-match`, `equals-unanswered-all-hidden`, `equals-answered-mismatch` |
| `notEquals` on all 7 types; **false on unanswered** (ADR-16 semantic 2) | `ops-not-equals` | `not-equals-all-differ`, `not-equals-unanswered-hidden`, `not-equals-equal-hidden` |
| `in` on all 7 types (element-wise `valuesEqual`) | `ops-in` | `in-match-all-types`, `in-no-match`, `in-unanswered` |
| `gt`/`gte`/`lt`/`lte` on number and date, incl. boundary | `ops-ordered` | `ordered-at-boundary`, `ordered-above`, `ordered-below`, `ordered-unanswered` |
| `answered` on all 7 types, incl. falsy answers (`false`, `""`, `0`, `[]`) | `ops-answered` | `answered-falsy-values`, `answered-none`, `answered-partial` |
| `contains`/`containsAny` membership vs `equals` set equality (ADR-21) | `ops-contains` | `contains-membership-vs-equality`, `contains-single-exact`, `contains-miss`, `contains-empty-answer`, `contains-unanswered` |
| `and`/`or`/`not` combinations, incl. `not` over unanswered ⇒ true | `combinators` | `combo-and-or-mixed-true`, `combo-all-false`, `combo-not-unanswered-true`, `combo-not-false-answer` |
| Nesting at depth 8 (the cap) | `depth-8` | `depth-8-true`, `depth-8-false` |
| Step-level target show/hide; step ∧ question layers | `step-gate` | `step-gate-shown-both-layers`, `step-gate-question-layer-hidden`, `step-gate-hidden`, `step-gate-stale-answer-excluded` |
| `visibleSteps` derivation (all-questions-hidden step drops out) | `step-empty` | `step-empty-drops-from-visible-steps` |
| Multiple rules targeting the same question (OR) | `multi-rule-target` | `multi-rule-first-only`, `multi-rule-second-only`, `multi-rule-none` |
| Hidden-answer exclusion chain (A controls B; B's answer feeds C) | `exclusion-chain`, `step-gate` | `chain-propagates`, `chain-hidden-answer-excluded`, `chain-middle-unanswered`, `step-gate-stale-answer-excluded` |
| Empty answers / all answered / partial with required missing | many | `*-unanswered`, `*-none`, `answered-partial`, `kitchen-sink-partial-missing-required`, `minimal-*` |
| Insurance flow as a sequence (answers appended step by step) | fixture `insurance` | `insurance-seq-1-empty`, `insurance-seq-2-smoker-yes`, `insurance-seq-2b-smoker-no`, `insurance-seq-3-complete` |
| Kitchen-sink end to end (both branches on, off, optional unanswered) | fixture `kitchen-sink` | `kitchen-sink-empty`, `kitchen-sink-partial-missing-required`, `kitchen-sink-complete`, `kitchen-sink-optional-unanswered`, `kitchen-sink-branches-off` |

## Adding a scenario

1. If the shape you need does not exist, add a corpus form under `forms/`
   (pin existing question fixtures and `q_gate_*` targets; keep it
   forward-only - the hygiene tests will hold you to it).
2. Add the scenario file with `description`, `form`, `answers`, and the
   `expected` FlowState you derive **from DOMAIN_SCHEMA §3** - not from
   running the evaluator and pasting.
3. `pnpm test:golden-drift` must pass; if it fails, reconcile your reading of
   the semantics before touching anything. A genuine disagreement between the
   documented semantics and the evaluator is a task-006 issue, not a corpus
   edit.
