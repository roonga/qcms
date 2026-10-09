# Golden evaluator corpus

The regression net for the rules evaluator's frozen semantics (task 007,
ADR-16, invariant I7). Each scenario describes _behavior as data_: a form, a
set of answers, and the exact `FlowState` the evaluator must produce - under
`SEMANTICS_VERSION = 1` - forever. The corpus survives refactors, doubles as
executable documentation of DOMAIN_SCHEMA §3, and is append-only.

Append-only is enforced now, not asked for (issue #727). `pnpm check:golden-append-only`
fails any change that modifies, deletes, or renames a file under this directory in the
diff against the default branch; adding scenarios, forms, and questions is always
allowed. It reads the diff, never committed history, so the recorded exception below
stays recorded rather than becoming a permanent red. This file is exempt from the
guard, because the rule is written here and any future amendment has to be written here
too.

## The rule for changing goldens

**A committed `expected` block changes only together with a
`SEMANTICS_VERSION` bump** (and the ADR that justifies it). If an evaluator
change makes any scenario fail, that change altered the frozen semantics:
either revert it, or treat it as a new semantics version - never "fix the
golden" to match new behavior. Adding _new_ scenarios (or new corpus forms and
questions for them) is always welcome and is how the corpus grows.

**There is no supersession mechanism, and that is deliberate.** The runner globs
every file in `scenarios/` and asserts each, so an appended scenario cannot
retire an existing one. A correction is therefore an amendment in place, under a
recorded exception below, or it is not taken at all. The two exceptions granted
so far are both **defect corrections**. Only the second is **hash-pinned** in the
guard: the first predates the guard covering this corpus at all, so there was
nothing for it to be pinned against (`packages/core/golden/evaluator/` joined
`GUARDED_PREFIXES` on 2026-09-02, the day after that amendment landed).

### The first recorded exception (issue #128, 2026-08-31)

`answered-falsy-values` was amended without a version bump, on the Code Owner's
ruling that **required means non-blank**: an empty or whitespace-only text value
is absence, so it no longer satisfies `required` and no longer answers
`answered`. The scenario had pinned the opposite. The reasoning for correcting
it in place rather than under a `SEMANTICS_VERSION = 2`:

- **A bump could not deliver what the rule protects.** The evaluator implements
  exactly one version at a time and refuses any other stamp
  (`UNSUPPORTED_SEMANTICS_VERSION`), so `2` would not make old snapshots keep
  their old behavior - it would make every already-published snapshot fail. The
  mechanism guards a migration path that does not exist yet.
- **No product-produced answer changes meaning.** Both control boundaries have
  reported an emptied field as absence since issue #98 (the renderer and the
  no-JS decoder), and the same change that made this amendment necessary also
  refuses `""` and `[]` at the API (ADR-33). The corrected behavior is reachable
  only by a value the product does not create and can no longer accept.
- **The pinned behavior was the defect.** A required question satisfied by the
  space bar is what issue #128 reported; the golden had frozen the bug.

This is a precedent for a **defect correction**, not for editing a golden that
disagrees with an intended semantics change. Anything that alters the outcome
for an answer a respondent can actually produce still needs the bump, and still
needs the evaluator to be able to honor both versions before it is taken.

### The second recorded exception (Q30, 2026-10-03)

`repeat-every-instance-empty-group` was amended without a version bump, on the
Code Owner's ruling that **a step holding a repeating group counts as a visible
step even when its roster is empty**, because the group's own chrome - its
heading and its Add control - is content a respondent can act on. Three fields
moved in that one scenario and the other 58 are untouched:

| Field              | Was              | Is                         |
| ------------------ | ---------------- | -------------------------- |
| `currentStep`      | `"stp_after"`    | `"stp_pax"`                |
| `visibleSteps`     | `["stp_after"]`  | `["stp_pax", "stp_after"]` |
| `visibleStepViews` | `stp_after` only | `stp_pax` first, then it   |

`visible`, `complete`, the required arrays and `rosters` are unchanged, so the
non-equivalence this scenario exists to pin - `everyInstance` FALSE over an empty
group while `not(anyInstance(not c))` is TRUE - is exactly as it was.

**The pinned behavior was the defect, and it made a form shape unreachable.** A
step whose only content was a repeating group had nothing visible while its
roster was empty; the roster was empty because the mint is due on the first serve
of the group's own step; and that step was never served because it was not a
visible step. The two facts held each other up. A form whose single step was a
repeating group answered its very first request with `step: null` and
`readyToSubmit: true` - "you have answered everything", before the respondent had
answered anything, with no control that could change it. It was not a property of
any one presentation: the stacked, per-instance-step and table presentations all
reached it.

**It rides the #128 precedent rather than a `SEMANTICS_VERSION` bump**, for the
same three reasons that precedent records, and they apply here at least as
cleanly. A bump could not deliver what the rule protects: the evaluator
implements exactly one version at a time and refuses any other stamp, so `2`
would fail every already-published snapshot rather than preserve its behavior.
No product-produced answer changes meaning - no answer changes meaning at all,
and what changes is that a form shape nobody could complete becomes usable. And
the pinned behavior was the defect, which is the sentence #128 is written around.

**The guard enforces this entry rather than being asked to ignore it.**
`scripts/check-golden-append-only.mjs` carries a `PINNED_EXCEPTIONS` list, and
this file's entry is:

- path: `packages/core/golden/evaluator/scenarios/repeat-every-instance-empty-group.json`
- SHA-256: `197c0d255e136d17f3e28808e98747cbb634fb301d13ec424bf6f85c607fd425`

A modification of that path passes **only** if the new bytes hash to that value.
A different edit to the same path, a deletion, a rename, or any change to an
unlisted file is refused exactly as before, so the file is not unguarded
afterwards: the only content it may hold is the one recorded here. The gate's
own test asserts that this document and the pin name the same file and the same
hash, so the human record and the machine check cannot drift apart. Adding an
entry is a Code Owner decision, as both of these were.

CI enforces drift two ways with the same runner
(`packages/core/src/golden-corpus.test.ts`):

- `pnpm test` - the corpus is part of the `@roonga/qcms-core` suite;
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
  "answers": [{ "questionId": "q_at_fault_accident", "value": true }],
  "expected": {
    "visible": [{ "stepId": "stp_src", "questionId": "q_at_fault_accident" }],
    "visibleSteps": ["stp_src"],
    "currentStep": null,
    "answeredRequired": ["q_at_fault_accident"],
    "missingRequired": [],
    "complete": true
  }
}
```

- `form` - path relative to `packages/core/`: either a canonical fixture
  (`fixtures/forms/valid/...`) or a corpus form (`golden/evaluator/forms/...`).
- `answers` - the _raw_ authored values; the runner hands them to the
  evaluator uncanonicalized, so NFC normalization and multiChoice
  deduplication stay part of the asserted surface. Each key may appear once.
- `rosters` - **optional, and absent from every scenario that has no repeating
  group** (see below).
- `expected` - the full `FlowState`, all arrays in document order.

### Repeating groups in a scenario (task 071, ADR-42)

Two fields carry repetition, and both are additive, which is what lets the
fifty-one scenarios committed before it stay untouched.

- An `answers` key is a bare `questionId` outside a repeating group and
  `instanceId/questionId` inside one, separated by `/`:
  `{ "questionId": "ins_p2/q_pax_dob", "value": "2024-06-15" }`. The field keeps
  the name `questionId` deliberately - renaming it would have edited every
  committed scenario, which is the one thing this corpus does not do.
- `rosters` is the **live** roster the evaluator is handed, in roster order:
  `[{ "groupId": "grp_pax", "instances": ["ins_p1", "ins_p2"] }]`. The evaluator
  never derives liveness and never reads a count answer to do it (that step is
  the API's, above it), so a scenario states the roster the way it states the
  answers. A scenario with no `rosters` key calls `evaluateRules` with three
  arguments exactly as every pre-071 caller does.

An instance the roster does not list is **removed**: its answers stay in the
scenario, are excluded from every condition, from the required accounting and
from `visible`, and are never deleted. `repeat-removed-instance-excluded` is
that case, and `repeat-count-shrunk-trailing-hidden` beside
`repeat-count-restored-answers-intact` is the shrink-and-grow pair.

`expected` then carries four optional fields - `visibleStepViews`,
`missingRequiredInstances`, `answeredRequiredInstances` and `rosters` - which
are **absent entirely** from a scenario whose form has no group. The six
original fields keep their exact shapes throughout: `missingRequired` lists a
repeated question **once**, and the per-instance detail is in the parallel array
beside it. Arrays over a group are in document then roster order: the span's
first question for every instance, then its second for every instance.

## Coverage matrix

| Matrix cell                                                             | Form(s)                        | Scenario file(s)                                                                                                                                        |
| ----------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `equals` on all 7 types; multiChoice set equality vs superset (ADR-21)  | `ops-equals`                   | `equals-all-types-match`, `equals-unanswered-all-hidden`, `equals-answered-mismatch`                                                                    |
| `notEquals` on all 7 types; **false on unanswered** (ADR-16 semantic 2) | `ops-not-equals`               | `not-equals-all-differ`, `not-equals-unanswered-hidden`, `not-equals-equal-hidden`                                                                      |
| `in` on all 7 types (element-wise `valuesEqual`)                        | `ops-in`                       | `in-match-all-types`, `in-no-match`, `in-unanswered`                                                                                                    |
| `gt`/`gte`/`lt`/`lte` on number and date, incl. boundary                | `ops-ordered`                  | `ordered-at-boundary`, `ordered-above`, `ordered-below`, `ordered-unanswered`                                                                           |
| `answered` on all 7 types, incl. falsy answers (`false`, `0`, `[]`)     | `ops-answered`                 | `answered-falsy-values`, `answered-none`, `answered-partial`                                                                                            |
| Blank text is absence: `""`, whitespace-only, vs merely padded (#128)   | `ops-answered`                 | `answered-falsy-values`, `answered-blank-text-unanswered`, `answered-padded-text-is-answered`                                                           |
| `contains`/`containsAny` membership vs `equals` set equality (ADR-21)   | `ops-contains`                 | `contains-membership-vs-equality`, `contains-single-exact`, `contains-miss`, `contains-empty-answer`, `contains-unanswered`                             |
| `and`/`or`/`not` combinations, incl. `not` over unanswered ⇒ true       | `combinators`                  | `combo-and-or-mixed-true`, `combo-all-false`, `combo-not-unanswered-true`, `combo-not-false-answer`                                                     |
| Nesting at depth 8 (the cap)                                            | `depth-8`                      | `depth-8-true`, `depth-8-false`                                                                                                                         |
| Step-level target show/hide; step ∧ question layers                     | `step-gate`                    | `step-gate-shown-both-layers`, `step-gate-question-layer-hidden`, `step-gate-hidden`, `step-gate-stale-answer-excluded`                                 |
| `visibleSteps` derivation (all-questions-hidden step drops out)         | `step-empty`                   | `step-empty-drops-from-visible-steps`                                                                                                                   |
| A group-bearing step is listed with an empty roster (Q30)               | `repeat-stacked`               | `repeat-every-instance-empty-group`                                                                                                                     |
| Multiple rules targeting the same question (OR)                         | `multi-rule-target`            | `multi-rule-first-only`, `multi-rule-second-only`, `multi-rule-none`                                                                                    |
| Hidden-answer exclusion chain (A controls B; B's answer feeds C)        | `exclusion-chain`, `step-gate` | `chain-propagates`, `chain-hidden-answer-excluded`, `chain-middle-unanswered`, `step-gate-stale-answer-excluded`                                        |
| Empty answers / all answered / partial with required missing            | many                           | `*-unanswered`, `*-none`, `answered-partial`, `kitchen-sink-partial-missing-required`, `minimal-*`                                                      |
| Insurance flow as a sequence (answers appended step by step)            | fixture `insurance`            | `insurance-seq-1-empty`, `insurance-seq-2-accident-yes`, `insurance-seq-2b-accident-no`, `insurance-seq-3-complete`                                     |
| Per-instance visibility: a rule inside a group reads its own instance   | `repeat-stacked`               | `repeat-per-instance-visibility`                                                                                                                        |
| `anyInstance`, and `instanceCount` at the boundary (four, then five)    | `repeat-stacked`               | `repeat-per-instance-visibility`, `repeat-instance-count-four-hidden`, `repeat-instance-count-five-shown`                                               |
| `everyInstance`: all match, one mismatch, and FALSE over an empty group | `repeat-stacked`               | `repeat-per-instance-visibility`, `repeat-every-instance-one-mismatch`, `repeat-every-instance-empty-group`                                             |
| The non-equivalence: `not(anyInstance(not c))` is TRUE over that group  | `repeat-stacked`               | `repeat-every-instance-empty-group`                                                                                                                     |
| A removed instance's answers excluded, never deleted                    | `repeat-stacked`               | `repeat-removed-instance-excluded`                                                                                                                      |
| A shrinking then restored `fromAnswer` count, same instance ids         | `repeat-from-answer`           | `repeat-count-shrunk-trailing-hidden`, `repeat-count-restored-answers-intact`                                                                           |
| Kitchen-sink end to end (both branches on, off, optional unanswered)    | fixture `kitchen-sink`         | `kitchen-sink-empty`, `kitchen-sink-partial-missing-required`, `kitchen-sink-complete`, `kitchen-sink-optional-unanswered`, `kitchen-sink-branches-off` |

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
