# Decision brief: conditional flows and question-level rule execution

Status: DRAFT for Code Owner discussion (2026-07-25). Supersedes nothing; if adopted, becomes an ADR with #31 and #23 re-scoped under it in the same change (staleness rule). Parked trigger: #31 (posting semantics) turned out to be the surface of this question.

## What is already decided and NOT on the table

- **Where logic runs:** the server. `@qcms/core`'s forward-pass evaluator is the only rule engine; the portal never evaluates (R2). "Question-level execution" can only mean *when the client posts an answer and when the UI applies the server's re-evaluation*.
- **Kernel capability:** question-level visibility already exists. `VisibilityRule.show` targets StepIds AND QuestionIds ("untargeted items are visible; a targeted item is visible iff at least one rule targeting it evaluates true"), and `contains`/`containsAny` test optionId membership in a multiChoice answer. This is shipped, golden-corpus-anchored surface - removing it is not a live option.
- **Navigation:** explicit Continue/Back/Submit, no collapse-on-answer (ADR-28, after the 045 incident).
- **Data:** answers are append-only; a hidden question's previously-given answer persists in the log. Visibility governs *validation and rendering*, not storage.

## Current runtime behavior (the accidental half-commitment)

| Control | Posts | Can gate a branch | Reveal timing today |
| --- | --- | --- | --- |
| boolean (radio) | on change | yes | immediate |
| multiChoice (checkbox) | on change, per toggle | yes (`contains`/`containsAny`, comparisons) | immediate, per toggle |
| singleChoice (radio/select) | on blur | yes | late (issue #31) |
| date | on blur | yes | late |
| longText | on blur | plausibly (comparisons) | late |
| number | on blur | yes | late |

We are already doing question-level reveal - for two control types - and built the branch-removal focus-recovery machinery (#76/#77) to cope. The inconsistency is per-type and unprincipled, which is why #31 reads like a simple bug but is not.

## Why multiChoice is the hard case

A multi-select has no natural commit moment. Concrete failure scenarios, all constructible with today's DSL:

1. **Mid-toggle churn.** Rule: `contains opt_diabetes` shows a follow-up in the same step. User toggles Diabetes on (question appears), reads it, toggles Diabetes off while deciding (question vanishes - with focus recovery firing), toggles on again (reappears). Three server round-trips, three layout shifts, all mid-interaction.
2. **Threshold flapping.** Rule: `count >= 2` (via comparison ops). Every toggle in the neighborhood of the threshold flips the branch both ways.
3. **Retained-answer re-reveal.** The follow-up was answered, then hidden by scenario 1, then re-revealed. The append-only log still holds the answer; the kernel's visible-required validation re-admits it. Correct by the data model - but the author never designed for "the answer survived a disappearance", and a respondent may not notice stale content is back.

None of these is a bug in the evaluator. They are UX/authoring semantics the runtime has not defined. They are also an a11y liability for the 030 manual pass: content appearing and vanishing while a screen-reader user is inside a checkbox group.

## Options

**A. Step-boundary evaluation only.** All conditional visibility resolves at Continue. Calm, trivially safe for multiChoice, and posting semantics become irrelevant to gating. But it regresses shipped behavior (boolean reveals), reduces progressive disclosure, and pushes authors toward step proliferation.

**B. Fully live, all types post on change.** Institutionalizes scenarios 1-3 and makes longText posting semantics absurd (per-keystroke or arbitrary debounce). Maximum API chatter. Rejected on its face; listed for completeness.

**C. Commitment semantics per control type.** Define "answer commitment" as a first-class concept:

| Control | Commit moment | Same-step reveal on commit |
| --- | --- | --- |
| boolean | on change (single discrete act) | yes |
| singleChoice (radio or select) | on change | yes (fixes #31 principledly) |
| date | on completion (all segments filled) | yes |
| number | on blur | yes |
| longText | on blur | yes |
| multiChoice | on **group exit** (blur leaving the group) | yes, at commit |

Server stays the evaluator; the client simply posts at commit. Reveals stay immediate for single-commit controls (matches today's boolean behavior and user expectation), and multiChoice gains a defined commit moment instead of per-toggle gating.

**D. C plus an authoring-time guard.** `compileDraft` warns - or refuses, Code Owner's call - when a rule whose conditions read a multiChoice answer targets a **same-step** QuestionId. Steers multiChoice-gated content to the next step, where Continue is the natural commit and none of scenarios 1-3 can occur. Compile-time, deterministic, testable; converts the worst UX case into a non-case without touching the DSL or the goldens (a *warning* adds no compile output change; a *refusal* is a breaking authoring change and needs the goldens checked).

## Recommendation

**C + D-as-warning.** Rationale:

- R2, ADR-28, the DSL, and the golden corpus are all untouched. This is a runtime-cadence and authoring-guidance decision, not a kernel change.
- It legitimizes what users already experience (immediate reveal for discrete choices) and fixes #31 as a consequence of a principle rather than a one-off.
- multiChoice group-exit commit still permits same-step gating for authors who insist, while the compile warning tells them why they probably should not. Escalating the warning to refusal later is additive; starting with refusal and relaxing is not.
- #23 (auto-advance/date input-mode configurability) slots into the same classification: auto-advance is only coherent for single-commit controls, so the commitment table serves both decisions.
- Scenario 3 (retained-answer re-reveal) should be *documented author-facing behavior* regardless of the option chosen: the data model is right, the surprise is real, and an authoring-UI hint (031-035) is the durable mitigation.

## Decisions needed from the Code Owner

1. Adopt commitment semantics (option C)? If yes, the table above is the contract to mark up.
2. D as warning or as refusal, for multiChoice-driven same-step targets?
3. Is multiChoice group-exit commit acceptable, or should multiChoice never gate same-step reveals at all (D-as-refusal makes C's multiChoice row moot)?
4. Retained-answer-on-re-reveal: keep (document it) or clear-on-hide (a kernel semantics change with append-only implications - substantially more expensive)?

On these calls, the PO drafts the ADR; implementation re-scopes #31 (+ #23 note) under it and goes back through the dev loop.
