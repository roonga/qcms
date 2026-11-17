# Proposed decisions

**Status:** proposed. Nothing in this file binds. Each proposal waits on a Code Owner ruling; on acceptance its text moves into [`core.md`](core.md) or [`portal.md`](portal.md) with a number from the index in [`README.md`](README.md), and its section here is deleted.

A proposal is cited by its issue number until then. It holds no ADR number, so no number is reserved or citable early.

| Proposal                                    | Issue | Ruling it implements | Proposed home on acceptance  |
| ------------------------------------------- | ----- | -------------------- | ---------------------------- |
| [Date bounds relative to today](#p-1288)    | #1288 | 2026-11-16           | new ADR, core; amends ADR-18 |
| [Exclusive option on multi-choice](#p-1289) | #1289 | 2026-11-16           | new ADR, core                |
| [Consent that must be agreed to](#p-1290)   | #1290 | 2026-11-16           | Note on ADR-36               |
| [Comparisons between two answers](#p-1291)  | #1291 | 2026-11-16           | new ADR, core                |
| [Decimal-place limit on a number](#p-1293)  | #1293 | 2026-11-16           | Note on ADR-32               |

Each ruling is recorded on its issue and bounds the proposal. Where an issue carries two rulings, both are applied; where the Code Owner marked one as standing (#1290, #1291), only that one is.

---

## Shared across all five

These hold for every proposal below and are stated once.

- **No change to rule evaluation.** None of the five alters `FlowState`. `SEMANTICS_VERSION` stays 1, the evaluator corpus (`packages/core/golden/evaluator/`) gains nothing and loses nothing, and I7 is untouched. The rules DSL (ADR-03) gains no operator and no operand.
- **Additive definition shape.** Every new field is optional and **absent rather than defaulted** (the ADR-42 precedent for `instanceId`), so a stored definition parses to the value it parses to today and an existing form compiles byte-identically apart from the compiler stamp.
- **Fail, never repair.** Each new check refuses with its own code, as every existing constraint does. Nothing is truncated, rounded or rewritten by the server.
- **Two enforcement moments, as today.** `validateAnswer` runs at answer save (`apps/api/src/features/responses/serve-step/handler.ts`, a 422 that stores nothing) and again in the submission sweep (`prepareSubmission`, I9). The no-JS whole-step POST reaches the same call.
- **Compiler golden corpus.** Four of the five add a prop or a node shape to compiled A2UI, so `COMPILER_VERSION` moves and the documented spec-bump procedure opens a new generation under `packages/a2ui-compiler/golden/`, carrying existing forms across unchanged apart from the stamp and adding one corpus form per feature. No committed golden is edited.
- **The vendored prop schemas are strict and frozen.** Every vendored A2UI props object is `.strict()` and ADR-22 forbids editing it (`packages/ui/src/author-messages.ts`). Today's schemas refuse three props proposed below: a relative `minValue` or `maxValue` (`date-picker.schema.ts` takes a string), `exclusive` on a `Checkbox` child, and a lone consent checkbox with a description. Each therefore needs a qcms-owned wrapper or node type (the `withAuthorMessages`, `Honeypot` and `RepeatGroup` precedents), which moves `COMPILER_VERSION` alone, or an upstream schema change and a pin move, which also moves `A2UI_SPEC_VERSION` (ADR-18's 2026-10-01 note).
- **The message key set is strict too.** `AuthorMessagesSchema` is qcms-owned but a fixed key set restating `ValidationMessageKey`. It admits none of `exclusive`, `requiredTrue`, `decimalPlaces` today, and a message keyed by `comparisonId` cannot join a fixed set at all. The three keys are added to it in step with the kernel; the comparison message needs its own wrapper prop.
- **Validation has no golden corpus today.** The evaluator corpus pins `FlowState`, not `validateAnswer`. Proposal #1288 needs pinned validation outcomes, so it proposes one (below); the other proposals add entries to it.
- **Documents the build PRs update:** `docs/DOMAIN_SCHEMA.md` (sections 2.2, 2.3, 4.3), `docs/a2ui-mapping.md`, `docs/COMPONENT_GUIDELINES.md`, `docs/agent-question-recipes.md` and the recipes under `apps/api/src/features/agent/prompts/recipes/`. This PR changes none of them.

### Open questions for the Code Owner (shared)

1. **Launch scope.** None of the five is in the "includes" list of `docs/PROJECT_GOAL.md` section 5. Are they launch scope (the cut-line moves, as it did for repetition) or `phase-4`? The answer may differ per proposal.
2. **One batch or five.** Built together they cost one compiler golden generation and one snapshot-shape decision; built apart, one generation each. Recommendation: one generation for whichever land together.
3. **`SNAPSHOT_SCHEMA_VERSION`.** Every change here is additive, but so was ADR-42, which moved it to 2. Does an additive widening of `QuestionDefinition` or `FormDefinition` move it to 3? Recommendation: one bump for the batch, by the ADR-42 precedent.
4. **A validation golden corpus.** Recommendation: `packages/core/golden/validation/`, append-only and added to `GUARDED_PREFIXES`, one file per scenario of `{ definition, value, today?, expected }`.
5. **Homes.** #1293 was ruled a "short ADR note"; the standing #1290 ruling names no record form. The proposed homes are a Note on ADR-32 (the constraint and message-key set) for #1293 and a Note on ADR-36 (the boolean decision) for #1290. Confirm, or assign numbers.
6. **Wrapper or upstream.** For each new compiled prop: a qcms-owned wrapper or node type (recommended; only `COMPILER_VERSION` moves), or an upstream `a2-react-aria` schema change with a pin move, which moves `A2UI_SPEC_VERSION`?

---

<a id="p-1288"></a>

## Proposal #1288 - Date bounds relative to today

**Status:** proposed.

### Context

- A `date` question's `min` and `max` are literal `YYYY-MM-DD` values (`packages/core/src/question-definition.ts`). A bound authored today is wrong tomorrow: a date of birth capped at the authoring date starts accepting future dates.
- R1 and ADR-18 make a published version immutable, and today its validation is a function of the snapshot and the answer alone. A relative bound adds a third input, the day.
- A date answer is timezone-less and respondent-local by design (`docs/DOMAIN_SCHEMA.md` section 2.4).

### Decision (as ruled)

- A date bound may be the literal `today` with an optional signed offset in days, months or years. An age floor is the same bound with a year offset, not a separate concept.
- It resolves on the server's calendar date at validation.
- An ADR amends R1 and ADR-18 for this one input. How R1's own sentence changes is open question 8.

### Definition and validation shape

```ts
const RelativeDate = z.object({
  relativeTo: z.literal("today"),
  offset: z
    .object({ unit: z.enum(["days", "months", "years"]), amount: z.number().int() })
    .optional(),
});
const DateBound = z.union([DateAnswerValue, RelativeDate]);
// constraints: { min?: DateBound, max?: DateBound }
```

- One unit per bound, so there is no order-of-operations question. `amount` is signed and non-zero; a magnitude cap keeps the result inside the four-digit year encoding.
- Examples: not in the future, `max: { relativeTo: "today" }`; at least 18, `max: { relativeTo: "today", offset: { unit: "years", amount: -18 } }`; within the next 90 days, `min` today and `max` today plus 90 days.
- **Core never reads a clock.** `validateAnswer` and `prepareSubmission` take the date as an explicit argument (`{ today: DateAnswerValue }`); the API derives it from its one wall-clock seam, `apps/api/src/clock.ts`. A definition with a relative bound validated without the argument is a typed error, not a silent pass.
- **Arithmetic** is ISO proleptic Gregorian, keeping the day and clamping to the last valid day of the month, which is the `overflow: "constrain"` default of `Temporal.PlainDate.add` and `subtract`: 2026-03-31 minus one month is 2026-02-28. It is written in core beside the existing leap-year table, not delegated to runtime `Temporal`: the repository's engine floor is Node 24 and `Temporal` is on by default only from Node 26.0.0.
- **Leap-day consequence, stated rather than discovered:** subtracting 18 years from 2028-02-29 gives 2010-02-28, and a person born 2008-02-29 first passes an 18-year floor on 2026-03-01.
- **Codes and message keys are unchanged:** `VALUE_BELOW_MIN`, `VALUE_ABOVE_MAX`, keys `min` and `max`. The built-in message quotes the resolved date, which is definition content plus the day, never the answer.
- **Parse and publish read no date.** Publish must stay deterministic (`ResolveQuestionVersion` in `packages/core/src/compile-draft.ts`), and a refusal that depends on the day would make the same draft publish on one day and fail on another. So: two literal bounds are checked as today (`MIN_ABOVE_MAX`); two relative bounds in the same unit are compared by amount; any other pair cannot be judged without a day and is a publish warning, not a refusal. `compileDraft` is called only by the publish handler (`apps/api/src/features/forms/handler.ts`); environment promotion and restore move stored versions and never re-run it, so neither can meet a day-dependent outcome.
- **The lock records the day.** `LockedSubmission` gains `evaluatedOn`, inside the hashed content, present only when the snapshot holds a relative bound, so a stored submission can be re-verified and a form without one keeps its `contentHash` shape.

### Proposed amendment text

> **ADR-18, amendment.** A published version's stored definition and compiled documents stay immutable and are served verbatim. Its validation is a function of the snapshot and the answers, with one named exception: a date bound relative to today also reads the server's calendar date, passed to core explicitly and recorded on the locked submission. No other time-dependent input is permitted.

The ruling names R1 as well. R1 reads "Published versions are immutable", which speaks of content, and no content changes here. Two readings are open (question 8): R1's sentence stays and the amendment above is cited beside it, or R1 gains a clause such as "validation of a date bound relative to today reads the server's calendar date (ADR-18 amendment)".

### Versioning and golden corpus

- Compiled A2UI stores the bound **in relative form**, never as a resolved date, so the stored bytes do not depend on the publish day. The vendored `DatePicker` schema takes a string bound, so the relative form travels in a qcms wrapper prop (shared question 6): new compiler generation with a `relative-date-bounds` corpus form.
- Validation corpus entries pin the evaluation date: the day before, on and after a bound; month-end clamp; leap day; a year offset.

### Portal and admin

- **Portal.** The serve response carries the server's `today` beside the stored document; the renderer resolves the bound from it for the `DatePicker`. The no-JS date fallback is three boxes with no native bound (`packages/ui/src/native-date-field.tsx`), so there the server check on the step POST is the enforcement. The browser clock is never read, so client and server agree except across midnight. **Caching:** the portal fetches every API response with `cache: "no-store"` (`apps/portal/lib/server/api.ts`), but the API's step response sets no `cache-control` of its own; a response that carries the day must be `no-store` at the API as well, which the build adds. `@internationalized/date`, already a `@roonga/qcms-ui` dependency, constrains month arithmetic the same way.
- **Admin.** The date bound editor offers a fixed date, today, or today plus or minus N days, months or years, with a line showing what the bound resolves to on the current day.
- Reporting and export are unaffected.

### What the assistant recipes then say

- `date-of-birth`: `constraints.max: { relativeTo: "today" }`, or a year offset for an age floor. The "it drifts" warning and the first two "Cannot be expressed" lines go. An age worked out from the date stays inexpressible.
- `past-date`, `future-date`: today as the moving bound; "within the last twelve months" and "within the next 90 days" become settings. A limit read from another answer moves to proposal #1291.

### Alternatives rejected

- **A general date expression.** Ruled out; the narrow vocabulary covers every corpus case.
- **A separate `minAge` constraint.** Ruled out; it is the same bound.
- **Resolve at publish.** That is the defect: a fixed date that drifts.
- **Resolve in the browser.** An untrusted clock, and the server could then disagree with the screen.
- **Resolve once at session start.** Stable across midnight, but a resumed session validates against a stale day.
- **`today` as a rules DSL operand.** It would put the day inside `FlowState` and break I7; out of scope.

### Open questions for the Code Owner

1. **Which time zone defines the server's calendar date?** Recommendation: one installation setting in the typed environment registry (an IANA zone id, default `UTC`), not a per-form setting.
2. **Respondent-local skew.** A respondent whose local date is ahead of the server's is refused when entering their own today against "not in the future". Accept that (recommended, with the zone set to where the form is used), or resolve each bound leniently against any calendar date current somewhere on Earth, which lets an age floor pass up to a day early?
3. **Across midnight.** The sweep re-validates with the submit-day date, so an answer accepted yesterday can fail at Submit. Confirm that is the intended reading of "at validation".
4. **`evaluatedOn` on the locked submission.** Confirm the addition to the hashed content.
5. **Leap-day births** pass an age floor on 1 March in a non-leap year. Confirm, since jurisdictions differ.
6. **Mixed bounds at publish.** A fixed `max` with `min` today becomes unanswerable once the fixed date passes. Recommended: publish reads no date and only warns, so publish stays deterministic and promotion and restore are unaffected. The alternative is a refusal when the pair is empty on the publish day, which makes publish day-dependent. Which?
7. **Rules that read today** ("show the guardian step if under 16") stay out. Confirm.
8. **R1's sentence.** Leave `PROJECT_INSTRUCTIONS.md` R1 as written and cite the ADR-18 amendment beside it, or add the clause quoted above to R1 itself?

### Sources

- MDN, `Temporal.PlainDate.prototype.add()`: <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/PlainDate/add>
- TC39 Temporal documentation, `PlainDate` `add` and `subtract`: <https://tc39.es/proposal-temporal/docs/plaindate.html>
- Node.js 26.0.0 release notes ("build: enable Temporal by default"): <https://nodejs.org/en/blog/release/v26.0.0>
- `@internationalized/date`, `CalendarDate` arithmetic and `today(timeZone)`: <https://react-aria.adobe.com/internationalized/date/CalendarDate>

---

<a id="p-1289"></a>

## Proposal #1289 - Exclusive option on multi-choice

**Status:** proposed.

### Context

- A `multiChoice` constrains the count of selections and nothing else. "None of the above" can be ticked with other answers, and neither the screen nor the server refuses it.
- `maxSelected: 1` is not the rule: it forbids every second answer, not the one combination.

### Decision (as ruled)

- `exclusive: true` is a property of the option; at most one exclusive option per question.
- The server refuses a response that ticks it alongside any other, with its own code and message key.
- With scripting the screen clears the other ticks when it is chosen; without scripting the server check is the enforcement point.

### Definition and validation shape

- `ChoiceOption` gains `exclusive: z.literal(true).optional()`.
- Parse refuses it on a `singleChoice` option (`EXCLUSIVE_OPTION_NOT_ALLOWED`) and refuses a second one in a question (`MULTIPLE_EXCLUSIVE_OPTIONS`).
- `validateAnswer`: a deduplicated selection that contains the exclusive option and any other fails with `EXCLUSIVE_OPTION_COMBINED`, constraint `exclusive`. `exclusive` joins `ValidationMessageKey` and is authorable only on a question that has such an option.
- **Count bounds.** A selection of the exclusive option alone is not held to `minSelected`; otherwise "none of these" on a "name at least two" question could never be chosen.
- Rule conditions read the answer as they do today; ADR-21's set equality is untouched (`equals [opt_none]`, `contains opt_none`).

### Versioning and golden corpus

- The exclusive option is marked in compiled A2UI. The vendored `Checkbox` schema is strict and has no such prop, so the marker travels in a qcms wrapper prop on the group naming the option (shared question 6): new compiler generation with an `exclusive-option` corpus form.
- Validation corpus entries: exclusive alone, exclusive with one other, exclusive alone under `minSelected: 2`, duplicates of the exclusive id.

### Portal and admin

- **Portal, with scripting.** Ticking the exclusive option clears the others. The behaviour sits in the qcms renderer over the group's controlled value, not in a fork of the component (ADR-22).
- **Commit moment unchanged (ADR-31).** The group still commits when focus leaves it, by which point the selection is consistent, so one post.
- **Without scripting.** The whole-step POST is refused and the step re-renders with the `exclusive` message on the group. GOV.UK's checkbox pattern prescribes the same fallback.
- **Admin.** One toggle per option row, "stands alone", enforced as one per question in the editor and at parse.
- Reporting and export are unaffected.

### What the assistant recipes then say

- `none-of-the-above`: mark the option `exclusive: true`, set `messages.exclusive`, drop the guidance line in `help` and the two-question workaround. "Cannot be expressed" keeps: a rule between two ordinary options, and a second standalone answer in the same question.
- `select-all-that-apply`: the first "Cannot be expressed" line goes and points at the recipe above.
- `voluntary-and-non-answer`: "Prefer not to say" or "Do not know" on a `multiChoice` may be the exclusive option. Where the source form keeps two such codes apart in one question, only one can be exclusive (open question 3), and the recipe says which stays unenforced.

### Alternatives rejected

- **A constraint naming option ids.** Ruled out; the property travels with the option and survives reordering.
- **Silent truncation to the exclusive option.** Ruled out; every other constraint fails.
- **Client-only enforcement.** A direct post and the no-JS path would bypass it.
- **Two questions, a filter then the list.** Works today, but changes the shape of the source form.

### Open questions for the Code Owner

1. **`minSelected` exemption** for the exclusive option chosen alone (recommended), or refuse at parse a question that has both?
2. **The reverse direction.** Should ticking an ordinary option clear a ticked exclusive one? Recommended yes; GOV.UK documents only the forward direction, and without the reverse the respondent must untick by hand to leave an invalid state.
3. **Several standalone answers.** The corpus has questions with two ("None of these" and "Prefer not to say"; BRFSS refusal and do-not-know codes). At most one may be exclusive as ruled, so the second stays unenforced. Confirm, or allow several where any one of them must stand alone.
4. **Position and divider.** GOV.UK shows the option last, after an "or" divider. Recommendation: no kernel rule on position; the admin places it last by default; a divider is a renderer follow-up.

### Sources

- GOV.UK Design System, Checkboxes, "Add an option for 'none'": <https://design-system.service.gov.uk/components/checkboxes/>

---

<a id="p-1290"></a>

## Proposal #1290 - Consent that must be agreed to

**Status:** proposed.

### Context

- `required` means the question holds a non-blank answer. A `boolean` carries no constraint, so a required consent answered No submits.
- The working substitute is a one-option required `singleChoice`, which renders as a one-member radio group.
- `docs/a2ui-mapping.md` compiles a `boolean` to a yes or no `RadioGroup` precisely because a lone checkbox "turns `required` into consent-must-check semantics". This proposal is the case where that is the intent.

### Decision (as ruled)

- Consent is first-class: a `requiredTrue` constraint on `boolean` with its own message key, presented as a single checkbox.
- The notice agreed to is identified by the form version the response records; no notice id or hash.
- The one-option `singleChoice` is not the recommended shape.

### Definition and validation shape

- `BooleanQuestion` gains `constraints: { requiredTrue?: true }`, absent on every existing definition.
- **Presence stays `required`'s job.** Parse refuses `requiredTrue` without `required: true` (`REQUIRED_TRUE_WITHOUT_REQUIRED`), so I9 and the sweep are unchanged: an unticked box is absence and reports `MISSING_REQUIRED`.
- `validateAnswer` refuses `false` with `MUST_BE_TRUE`, constraint `requiredTrue`. The ledger for such a question therefore holds `true` or a retraction, never `false`.
- **One message for one state.** A respondent cannot tell "unticked" from "false", so `requiredTrue` joins `ValidationMessageKey` and replaces `required` as the authorable key on such a question; the portal shows it for both failures.
- **Labels.** `label` is the question, `help` holds the notice, `yesLabel` is the checkbox's own label. `noLabel` has nothing to label and is refused at parse.
- **Accessibility.** Three texts cannot sit on one vendored `Checkbox`, whose schema has a `label` and no description. The control is a group: the question `label` names it (group and legend semantics), `help` is its description (`aria-describedby` on the group), and the one checkbox inside is labelled by `yesLabel`. The error message is associated with the checkbox, which also carries the required state. **The box is never pre-ticked**; it renders ticked only when the server already holds `true` for the session. A long notice read as one described-by string is poor listening, so the recipe keeps long notice text in step content above the question and a short pointer in `help`.
- A rule condition `equals false` on such a question can never match; publish warns.
- **Notice version.** R1 already makes the notice text recoverable: the response pins a form version, which pins the question version holding `label`, `help` and `yesLabel`.

### Versioning and golden corpus

- A `boolean` with `requiredTrue` compiles to a qcms-owned consent node (a labelled, described group holding one checkbox), since the vendored `Checkbox` cannot carry the description and a vendored `CheckboxGroup` would be indistinguishable from a `multiChoice` (shared question 6). New compiler generation with a `consent` corpus form; every other `boolean` keeps its `RadioGroup`.
- Validation corpus entries: `true`, `false`, and the sweep with the question absent.

### Portal and admin

- **Portal.** One checkbox. Ticking commits `true` on change (the ADR-31 boolean row); unticking posts a retraction where the server holds an answer (ADR-33). Without scripting an unticked box posts nothing, and the decoder does not read that correctly today: `packages/ui/src/native-submit.ts` tells a cleared field from an untouched one only by the answered marker (`__qa__`), and `NativeFieldKind` has no kind for a lone checkbox (`radio` decodes `"true"` and `"false"`, `multi` decodes an array). The build adds a kind: a ticked box decodes to `true`, an absent value with the answered marker is a retraction, and an absent value without it is untouched.
- **Admin.** A "must be agreed to" switch on a yes or no question, which sets `required`, hides the No label and previews the checkbox.
- **Reporting and export.** The column is a boolean as today; it holds `true` for every submitted response in which the question was visible.
- Existing forms built on the substitute keep working; nothing migrates.

### What the assistant recipes then say

- `consent-and-acknowledgement`: `boolean`, `required: true`, `constraints.requiredTrue: true`, the agreement as `yesLabel`, the notice in `help`, `messages.requiredTrue`. The one-answer list and its explanation go. The yes or no variant for recording a refusal stays.
- `declaration-and-signature`: the agreement uses the same shape. A signature stays inexpressible.

### Alternatives rejected

- **One-option `singleChoice` with a tick-box presentation.** Not the standing ruling: the stored value is an option id, not an agreement, and the reporting column reads as a choice.
- **A consent question type.** The closed set stays seven.
- **`required` means true for every boolean.** Changes the meaning of published forms.
- **A notice id or hash on the answer.** Ruled out; the form version identifies it.

### Open questions for the Code Owner

1. **`requiredTrue` without `required`.** Refuse at parse (recommended), or let `requiredTrue` imply presence?
2. **Message keys.** One key, `requiredTrue`, for both the unticked box and a posted `false` (recommended), or keep `required` for the unticked box?
3. **Checkbox label.** `yesLabel`, required at publish for such a question (recommended, since the lexicon's "Yes" beside a lone checkbox reads poorly), or the question `label`?
4. **`equals false` rules** on such a question: publish warning (recommended) or refusal?
5. **Association of the three texts.** A group named by `label`, described by `help`, holding one checkbox labelled by `yesLabel`, as proposed? And should a long notice live in step content with `help` as a pointer (recommended)?

---

<a id="p-1291"></a>

## Proposal #1291 - Comparisons between two answers

**Status:** proposed.

### Context

- Every constraint operand and every rule operand is a literal. An end date before its start date is accepted at every layer.
- A question definition is a library item that does not know which form pins it (ADR-02), so it cannot name another question.

### Decision (as ruled)

- Narrow comparisons between two questions of the same type: equal, before or after, at most or at least.
- Enforced in the submission sweep; the error names both questions.
- "One of these must be answered" is a separate decision.
- It must not become a second rule engine.

### Definition and validation shape

A form-level list, beside `steps` and `rules`:

```ts
const Comparison = z.object({
  comparisonId: ComparisonId,
  left: QuestionId,
  operator: z.enum(["equals", "lt", "lte", "gt", "gte"]),
  right: QuestionId,
  message: LocalizedText.optional(),
});
// FormDefinition: { ..., comparisons?: Comparison[] }
```

- Read as "left operator right": `q_end_date gte q_start_date`. The operator names are the DSL's, and the implementation is the existing `valuesEqual` and `compareValues`.
- **Publish refuses:** an unpinned question, two different types, `left` equal to `right`, an ordered operator on anything but `number` or `date`, `equals` on anything but `shortText`, `number` or `date`, and a pair that is not both outside every repeating group or both inside the same one.
- **Sweep.** After the per-question pass, each comparison is checked only when both sides are visible, answered and individually valid; otherwise it is skipped, absence being `required`'s concern. Inside a group it is checked once per live instance, within that instance.
- **Error.** `SubmissionError` gains `COMPARISON_FAILED` with `comparisonId`, `leftQuestionId`, `rightQuestionId` and an optional `instanceId`. The message names ids only.
- Text equality is exact on the canonical NFC string, so case differs means different.

**What keeps it from being a second rule engine.** No literal operand, no combinator, no arithmetic or offset, no effect on visibility, not readable by a rule, no comparison depending on another. Each is one independent check, the cost is linear in the list, and the evaluator never sees it.

### Versioning and golden corpus

- `FormDefinition` gains an optional field; the snapshot question is shared question 3.
- The authored message is compiled into the stored document on the later question's control (ADR-32), keyed by `comparisonId`. `AuthorMessagesSchema` is a fixed key set, so it travels in a separate qcms wrapper prop beside `messages`: new compiler generation with a `comparisons` corpus form.
- The submission fixtures under `packages/core/fixtures/submissions/` gain cases: pass, fail, one side hidden, one side unanswered, per instance.

### Portal and admin

- **Portal.** A failed comparison surfaces at Submit. The portal lands on the step holding whichever of the two questions is later in document order and shows the message on that question, naming the other by its label.
- **Admin.** A "Checks" list in the form builder, authored as a sentence ("End date must be on or after Start date") with the same structured editing rules have. It belongs to the form, not to the question editor.
- Reporting and export are unaffected.

### What the assistant recipes then say

- `date-range`: add a comparison, end date `gte` start date, with a message. The first "Cannot be expressed" line goes; day counts and overlap between ranges stay.
- `email-address`: a confirm box is a second `shortText` with an `equals` comparison. "One of two contact questions" stays inexpressible.
- `quantity`: a count can be held at or below another number answer.
- `age-in-years`: unchanged. Age against a date of birth is arithmetic, not a same-type comparison.

### Alternatives rejected

- **An expression language.** Ruled out.
- **A constraint on the question naming another question.** A library question does not know its form.
- **A question reference as a rules DSL operand.** It enters the evaluator, and a semantics change cannot be taken while the evaluator implements one version.
- **Refusing at answer save.** The other side may not be answered yet, the outcome would depend on the order of answering, and an individually valid answer belongs in the append-only ledger.

### Open questions for the Code Owner

1. **Feedback before Submit.** The sweep is the enforcement as ruled, so a respondent learns of a reversed date range only at Submit. Also report a failed comparison on Continue from the step holding the later question (advisory, same core function), or Submit only for the first build (recommended)?
2. **Group scope.** Both outside or both in the same group, as proposed. Also allow one outside and one inside ("each service date on or after the admission date"), checked per instance?
3. **Operators per type.** The ruling reads "equal, before/after, at most/at least". Literally that is strict `lt` and `gt` for dates and inclusive `lte` and `gte` for numbers. The proposal allows all four ordered operators on both types, and the date-range recipe relies on `gte` over dates (an end date equal to the start date is valid). Confirm all four on both (recommended), or the literal split.
4. **`equals` types.** `shortText`, `number`, `date` as proposed, or wider?
5. **Case in text equality.** Exact as proposed, which fails a confirm-email box that differs only in case.
6. **"At least one of"** needs its own issue. Not filed by this PR.

---

<a id="p-1293"></a>

## Proposal #1293 - Decimal-place limit on a number

**Status:** proposed.

### Context

- A `number` constrains `min`, `max` and `integer`. A money amount accepts any number of decimals.
- The canonical encoding is a finite IEEE double (`docs/DOMAIN_SCHEMA.md` section 2.4).

### Decision (as ruled)

- A decimal-places scale on `number`, enforced by the server, compiled as the input step and used for locale-aware formatting.
- Currency stays prose, in the label and help. Storage stays an IEEE double.
- Derived or calculated questions are a separate decision, to be filed as its own `phase-4` issue.

### Definition and validation shape

- `constraints.decimalPlaces: z.number().int().min(1).max(6).optional()`.
- Parse refuses it together with `integer: true` (`DECIMAL_PLACES_WITH_INTEGER`), and refuses a `min` or `max` that itself has more decimals than the scale (`BOUND_EXCEEDS_DECIMAL_PLACES`): the HTML step base is `min`, so an off-scale `min` would make every on-scale value a step mismatch in the browser.
- `validateAnswer` fails with `TOO_MANY_DECIMAL_PLACES`, constraint `decimalPlaces`; `decimalPlaces` joins `ValidationMessageKey`.
- **The test on a double** is `Number(value.toFixed(n)) === value`: the value is the double nearest to a decimal of at most `n` places. Multiplying and testing for an integer is wrong on doubles (`0.57 * 100` is `56.99999999999999`) and is not used. `toFixed` accepts 0 to 100 digits and falls back to exponent notation only at magnitudes of 10^21 and above, where the comparison still holds.
- A value computed in floating point by a client (`0.1 + 0.2`) is refused at two places. That is correct: it is not a two-place decimal.
- The canonical encoding, the ledger, rule comparison and the CSV column are unchanged.

### Versioning and golden corpus

- Compiled A2UI carries `step` only (`0.01` for two places). `step` is an existing prop of the strict `NumberField` schema, so no schema change and no wrapper; `formatOptions` is not in that schema and is not compiled. The mapping gains a rule, so a `decimal-places` corpus form joins whichever generation the batch opens.
- Validation corpus entries: `12.5`, `12.345`, `0.57`, `1.005`, `0.30000000000000004`, a negative, `-0`, a value at 10^21.
- **One entry pins the precision ceiling.** Above about 2^46 the spacing between doubles exceeds 0.01, so every double passes a two-place limit: the check cannot refuse there, because no finer value is representable. The entry records that as intended; a `max` the form can defend is what keeps amounts far below it.

### Portal and admin

- **Portal.** The renderer forwards `step` but not a compiled format: `packages/ui/src/registry.tsx` sets `formatOptions` itself, `maximumFractionDigits: 0` for an integer step and the React Aria default otherwise. That default shows at most three fraction digits, so the adapter must derive `maximumFractionDigits` from `step` for a scaled field, as `docs/COMPONENT_GUIDELINES.md` rule 13 requires of every constraint expressible as a format. React Aria then formats and parses in the respondent's locale. Without scripting, `packages/ui/src/native-number-field.tsx` renders `<input type="number">` with the same `step`, so the browser reports a step mismatch; that is advisory and the server stays authoritative.
- **Admin.** A "decimal places" field on a number question, mutually exclusive with "whole numbers only".
- **Reporting and export.** Values are emitted as stored (`12.5`, not `12.50`).

### What the assistant recipes then say

- `money-amount`: `constraints.decimalPlaces: 2` and `messages.decimalPlaces`. "Two decimal places" leaves "Cannot be expressed"; the currency stays in the label, and a total is still typed in.
- `quantity`: a measurement may carry a scale. A step other than a power of ten ("multiples of five") stays inexpressible.

### Alternatives rejected

- **Compiling `formatOptions` into the document.** Refused by the strict vendored schema, and unnecessary: the adapter derives the format from `step`, which needs no schema change and keeps formatting a render-time concern.
- **An arbitrary `step`.** Wider than ruled, and it brings the step-base rule into the kernel.
- **A currency field on the question or the form.** Ruled out; a per-question currency makes a reporting column ambiguous.
- **A decimal string or minor-unit integer encoding.** Ruled out; it changes the canonical encoding, the ledger, export and rule comparison.
- **Rounding on the server.** A repair; every other constraint fails.
- **Calculated questions.** Ruled out of scope.

### Open questions for the Code Owner

1. **Upper limit of the scale.** 6 as proposed?
2. **`decimalPlaces: 0`.** Refused, with `integer: true` staying the one spelling of a whole number (recommended), or accepted as an alias?
3. **Display padding.** Show `12.5` as typed (recommended, since the field is a limit and not a currency), or pad to the scale (`12.50`) with `minimumFractionDigits`?
4. **Client snapping.** React Aria's documented default `commitBehavior` is `snap`: a typed `12.345` becomes the nearest step on blur, before commit, as an `integer` field already does today. The adapter does not set the prop and the vendored schema does not carry it, so `validate` would be a render-time adapter change, and only if the pinned React Aria version has the prop. Keep the snap (recommended, consistent with integers), or show an error instead of a changed value?
5. **Sums in reporting** over doubles can show float noise. Round aggregates to the column's scale, or leave reporting untouched (recommended for this decision)?
6. **The calculated-questions issue** is ruled as a `phase-4` issue. Not filed by this PR.

### Sources

- MDN, `Number.prototype.toFixed()`: <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/toFixed>
- MDN, HTML `step` attribute (step base, default step, validity): <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/step>
- React Aria, `NumberField` (`step`, `formatOptions`, `commitBehavior`): <https://react-aria.adobe.com/NumberField>
