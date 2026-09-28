# Repeating groups and table input

**Status:** proposed, nothing decided, nothing built. This is a design document written at the Code Owner's request against `origin/main` at `c1988256`. It proposes **one** new kernel concept, the **repeating group**, and argues that all three of the capabilities asked for (a looping question, a looping page or step, and a table input) are presentations of it rather than three mechanisms. Section 10 carries **twenty-three numbered questions**, each with a recommendation, the options and what each option costs; seven of them are ADR-sized and section 10 drafts the ADR text a ruling would produce. Nothing in `docs/adr/`, `docs/SECURITY_DESIGN.md` or `docs/features/README.md` is edited by this document: every change to those is proposed here and made by the task that lands it.

**This is Phase 4 work.** It is not on `docs/PROJECT_GOAL.md` section 5's exclusion list, which means it is **new scope** rather than an early scratch of a deferred itch, and R7's cut-line rule ("an itch is written down as an issue, not scratched") applies to it exactly as it applies to the listed items. Nothing here gates launch and nothing here is dispatched before task 038. Q1 asks the Code Owner to confirm that placement.

**Concept pages (published separately).** Three HTML concept pages accompany this document: `portal-passengers.html`, the respondent view of the airline passenger loop; `portal-table-input.html`, the respondent view of the assets table beside the same data as stacked cards; and `admin-authoring.html`, the admin group settings, the column editor and the rules editor with instances. They are **concepts to react to, not approved designs**, and they are deliberately **not committed to the repository**, so that nothing mistakes them for `plan/admin-shell-poc/*.html`, which are the approved-design POCs. Each page opens with a caption naming the questions in section 10 it illustrates and the recommendation it shows.

---

## 1. The problem, and the two use cases end to end

QCMS has no way to ask the same question twice. `Step.items` is an array of `QuestionRef` pins, and `FormDefinition`'s own refinement (`packages/core/src/form-definition.ts`, `DUPLICATE_QUESTION_IN_FORM`) refuses a `questionId` pinned more than once anywhere in a form, with the reason stated in the code: duplicates "make rule targeting and answer keying ambiguous, so they are malformed input". The keying it protects is real. An answer is keyed by a bare `questionId` in three places at once: the evaluator's `AnswerMap = ReadonlyMap<QuestionId, AnswerValue>`, the `answers` table's `(session_id, question_id)` grain, and `reporting.answers_flat.question_id`. One question, one answer, everywhere.

So a form that needs six passengers today has to carry thirty-six questions with thirty-six ids, authored by hand, with the passenger count expressed as thirty rule targets. That is not a workaround, it is a different form.

### 1.1 The airline reservation, as a respondent

The respondent opens a link and answers the trip questions: origin, destination, dates, cabin. Then:

1. **The count.** "How many passengers are travelling?" They answer 3. Or, in the other shape the Code Owner named, there is no count question and the form simply shows one passenger with an **Add another passenger** button.
2. **The loop.** Three blocks appear, headed "Passenger 1", "Passenger 2", "Passenger 3". Each block holds the same six questions: full name, date of birth, passport number, seat preference, meal, special assistance. The respondent fills passenger 1, scrolls, fills passenger 2, and gets partway through passenger 3.
3. **Branching inside an instance.** Passenger 2's date of birth is in 2024, so an "Infant fare basis" question appears **under passenger 2 and under nobody else**. This is the case that makes repetition a kernel feature rather than a rendering trick: the rule has to read one instance's answer and show one instance's question.
4. **Branching across instances.** Because at least one passenger is an infant, an "Infant travel declaration" question appears once, later, outside the loop. The condition is "any passenger's date of birth is after 2024-01-01".
5. **Continue.** The step is refused, and the respondent is told why in a summary that names the instance: "Passenger 2: passport number is required", "Passenger 3: date of birth is required". Each entry is a link that moves focus to that field, in that instance.
6. **Removal.** The respondent realises passenger 3 is not travelling. They press **Remove passenger 3**. Passengers 1 and 2 keep their answers and keep their headings; nothing renumbers under them.
7. **Review.** A later step lists all passengers with the answers given, and an **Edit** link per passenger back into the loop.
8. **Submit.** The locked answer set holds two passengers' six answers each, addressed so that a downstream system can tell whose passport is whose.

Without JavaScript, every one of those steps happens through one whole-step POST and one re-render. That is not a degraded mode: `docs/portal-constraints.md` states the claim unqualified, "there is no question shape a respondent without scripting cannot answer", and its exception list has been empty since issue #988.

### 1.2 The airline reservation, as an author

The author already has the six passenger questions in the library, each with its own `questionId`, each pinned at a version. They open the form builder, open the Passengers step, and add a **repeating group**. They:

- name it and give it a group id (`grp_passengers`);
- drag the six questions into it;
- choose the **count source**: fixed at 1, driven by `q_passenger_count`, or open-ended;
- set **min 1, max 9**;
- write the **instance label template**, "Passenger {n}";
- choose the **presentation**: all instances stacked on one page, one instance per step page, or a table.

They then write two rules. The first targets a question inside the group and is evaluated per instance, which the rules editor states on the rule ("evaluated per passenger"). The second uses a new operator and reads the whole group: `anyInstance`. Nothing about the six questions themselves changes, and none of them is edited: **a question does not know it is repeated**, which is the property that keeps ADR-02 and R6 clean and lets the same question be repeated in one form and single in another.

### 1.3 The financial product questionnaire

The same machinery, twice, with different presentations.

**Income sources**, as a stacked group: each instance holds source type, amount, frequency and owner, open-ended, min 1, max 20. A rule inside the group shows "Employer name" only when the source type is salaried. A rule outside the group shows a "Total income declaration" when `instanceCount` is 5 or more.

**Holdings**, as a table: the same group shape with `presentation: "table"`. Instances become rows; the group's member questions become columns (asset type, description, value AUD, ownership). The respondent sees a grid, adds and removes rows, and reads a column total. On a phone the grid reflows to one card per row, which is the constraint that decides the accessibility design in section 4.

The two are the same object with one field different. That is the whole argument of section 2.

---

## 2. Model options, and the recommendation

### 2.1 The recommendation in one paragraph

Add exactly one concept to the kernel: a **repeating group**, a named, ordered set of pinned question refs that lives inside a `Step`'s item list and is answered once per **instance**. An instance carries a stable, opaque, session-scoped id that is minted once and never reused or renumbered; the ordinal a respondent reads ("Passenger 2") is its position in the live roster and is presentation only. A **looping question** is a repeating group with one member. A **looping step** is a repeating group whose presentation paginates its span into one step view per instance. A **table** is a repeating group whose presentation lays instances out as rows and members as columns. One model, one answer-addressing scheme, one storage grain, one rules reach, one export shape, three presentations.

### 2.2 Option set for the container

| Option                               | What it is                                                                              | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Repeat on a single question**   | A `repeat: {min, max}` field on `QuestionDefinition`, making a question's answer a list | **Rejected.** It changes `AnswerValue` (a new non-scalar member of a union whose own doc says it is untagged by design), it changes what `validateAnswer` returns, and it cannot express the airline case at all, because six questions have to repeat together. It also makes repetition a property of a **question**, which breaks reuse: the same question could not then be single in one form and repeated in another without a new `questionId` (R6). |
| **B. Repeating group inside a step** | A container in `Step.items` holding question refs plus a count rule                     | **Recommended.** Additive to `FormDefinition`, leaves `QuestionDefinition` and `AnswerValue` untouched, and expresses all three capabilities.                                                                                                                                                                                                                                                                                                               |
| **C. Repeating step**                | A `repeat` field on `Step`, making the whole step iterate                               | **Rejected as the primitive, kept as a presentation.** As a primitive it forces a group to occupy a whole step, which the financial case does not want (an income-source loop sits beside other questions), and it puts the iteration on the object that also carries navigation, so the ADR-28 cursor and the loop would be one concept. As a **presentation** of B it is exactly the looping-page capability, with no second model.                       |
| **D. A sub-form reference**          | A form embedded in a form, repeated                                                     | **Rejected.** It multiplies publish, pinning and version resolution by a second axis for no capability B does not have, and a sub-form would need its own rules scope, its own snapshot and its own compiled documents.                                                                                                                                                                                                                                     |

### 2.3 Option set for the table

| Option                                      | What it is                                                                                        | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1. A distinct `table` question type**    | An eighth member of the `QuestionDefinition` union, whose answer is a matrix in one `AnswerValue` | **Rejected, and this is the load-bearing call of the document.** It costs a new `AnswerValue` member, which is the first structured value in a union whose doc says the wire form is the raw JSON value. It breaks "empty is absence" per cell, because `isBlankAnswerValue` is deliberately type-blind and has no reading of "all cells empty". It makes the whole table one ledger row, so a per-cell retraction (ADR-33) is inexpressible, per-cell validation cannot report `{code, constraint, message}` against a cell, and a partial table cannot be stored. It breaks the CSV and reporting grain, which is one row per question. And it grows eight exhaustive `never`-guarded switches across core, the compiler, the renderer and the admin's parallel list. |
| **T2. A presentation of a repeating group** | `presentation: "table"` on the group; rows are instances, columns are member questions            | **Recommended.** Every cell is an ordinary question with an ordinary `AnswerValue`, so per-cell validation, per-cell retraction, "empty is absence" per cell, the rules DSL, the ledger grain, the export grain and the reporting view all work unchanged. The table is then a **layout**, and `@roonga/qcms-ui` gains a layout component rather than an input control.                                                                                                                                                                                                                                                                                                                                                                                                 |

T2's cost, named honestly: an author who thinks "table question" has to learn that a table is a group with columns, and the column set is constrained to the cell types Q12 settles. That is a vocabulary cost in the admin, which section 6 spends on labelling rather than on a second model.

**What T2 buys that is easy to miss.** `docs/COMPONENT_GUIDELINES.md` opens by splitting work into ADR-sized ("a new question type, the kernel's closed set grows") and checklist-sized ("a new rendering for an existing type"). Under T2 **no question type is added**: the kernel's closed set of seven is unchanged, `AnswerValue` is unchanged, and no new adapter translates a raw control value to a canonical `AnswerValue`. The kernel change (the container) is ADR-sized because `FormDefinition` and the rules DSL grow; the rendering change is checklist-sized, and the parts of the thirteen-item checklist that bind are the ones about behaviour rather than registration: the no-JS path, the focus targets, the theming tokens, the lint coverage and the controlled-adapter contract. Items 1 to 3 (vendoring, registry entry, the ADR-31 commit moment) do not bind a layout container, and item 4's clear path binds the cells, which already have one.

### 2.4 Count source

Three sources, all wanted, one schema:

```ts
const RepeatCount = z.discriminatedUnion("source", [
  z.object({ source: z.literal("fixed"), count: z.number().int().min(1) }),
  z.object({ source: z.literal("fromAnswer"), questionId: QuestionId }),
  z.object({
    source: z.literal("open"),
    min: z.number().int().min(0),
    max: z.number().int().min(1),
  }),
]);
```

- **`fixed`** is the degenerate case and is what a looping question with a known count uses.
- **`fromAnswer`** points at a `number` question that must appear **strictly before** the group in document order, which is the same rule `analyzeRuleGraph` already enforces for rule references (ADR-16, I10) and is refused at publish with a new code rather than a new mechanism.
- **`open`** is add and remove, and `max` is **required** on it. An open-ended group with no maximum is an unbounded write path into an append-only ledger, which section 8 treats as an abuse control and not as an authoring convenience.

`min` and `max` apply to all three sources as validation bounds; for `fixed` they are derived from the count and for `fromAnswer` they bound what the count question may produce, so a count answer of 400 against `max: 9` is refused at the count question rather than discovered at the loop.

### 2.5 Nesting

**Recommend a hard depth of one: a repeating group may not contain a repeating group.** The kernel refuses it at parse. The reasons are cost and comprehensibility in that order: a nested group makes an instance address a path rather than a pair, makes the evaluator's per-instance walk quadratic in instances, makes the no-JS field name a path, makes the CSV grain a tree, and makes an error summary say "Passenger 2, Bag 3: weight is required" before anyone has read whether that sentence is usable. Nothing in either sample use case needs it. Q13 asks the Code Owner to confirm, and records what lifting the cap later would cost.

### 2.6 Per-instance labels

The group carries `instanceLabel: LocalizedText` with a single `{n}` placeholder, "Passenger {n}". `{n}` is the **live ordinal**, one-based, recomputed after a removal, so removing passenger 2 of three leaves headings "Passenger 1" and "Passenger 2" and not "Passenger 1" and "Passenger 3". The stable instance id never appears to a respondent. Publish validates that the template is present for the default locale and, per ADR-11 and the `LOCALE_INCOMPLETE` check, for every locale the form declares; a template with no `{n}` is allowed (a group of one), a template with an unknown placeholder is refused.

**Why the ordinal is presentation and the id is identity.** If the respondent's ordinal were the key, removing passenger 2 would re-target passenger 3's passport answer at passenger 2's row, silently, in the ledger and in every export already taken. That is the R6 failure mode one level down: an id that is reused with a different meaning. The roster is what makes the ordinal derivable and the id permanent.

---

## 3. Kernel impact

Everything in this section is **additive**, and that is a requirement rather than an aesthetic. `packages/core/golden/evaluator/CORPUS.md` and ADR-16's own amendment both record that a `SEMANTICS_VERSION` bump **cannot currently be taken**: the evaluator implements exactly one version at a time and refuses any other stamp, so bumping to `2` would not preserve old snapshots' behaviour, it would make every published snapshot fail at serve, answer and submit alike. Multi-version evaluation is the missing prerequisite and is not in scope here. The design rule that follows is absolute:

> **A form with no repeating group must parse, compile, evaluate, validate, submit, export and report byte-identically to today, including the exact shape of `FlowState`.** All forty-four committed golden evaluator scenarios pass unchanged, with no `expected` block edited.

### 3.1 Schema

```ts
const GroupId = /* branded, grp_... */;

const RepeatGroup = z.object({
  groupId: GroupId,
  label: LocalizedText,
  instanceLabel: LocalizedText,        // "Passenger {n}"
  items: z.array(QuestionRef).min(1),
  count: RepeatCount,
  presentation: z.enum(["stacked", "perInstanceStep", "table"]).default("stacked"),
});

const Step = z.object({
  stepId: StepId,
  title: LocalizedText,
  items: z.array(z.union([QuestionRef, RepeatGroup])).min(1),   // was z.array(QuestionRef)
});
```

The union is discriminable without a tag because the two shapes have disjoint required keys (`questionId` against `groupId`), so every form definition that exists today parses unchanged. Q2's ruling decides whether to carry an explicit `kind` discriminator anyway; the recommendation is not to, because adding one would be the one change in this section that is not additive.

**`DUPLICATE_QUESTION_IN_FORM` stays exactly as it is**, and is extended to reach inside groups: a `questionId` is pinned at most once in a form whether it sits in a step or in a group. A question is therefore either repeated or not, in a given form, and the refinement's stated reason (unambiguous answer keying) holds under the new key as it did under the old.

New publish-time codes, all in the existing `PublishError` union and all reported alongside the others rather than short-circuiting: `DUPLICATE_GROUP_ID`, `REPEAT_COUNT_BACKWARD_REF` (a `fromAnswer` source whose question does not precede the group), `REPEAT_COUNT_NOT_A_NUMBER` (it is not a `number` question), `REPEAT_NESTING_NOT_ALLOWED`, `REPEAT_MAX_ABOVE_CEILING`, `REPEAT_MIN_ABOVE_MAX`, `INSTANCE_LABEL_PLACEHOLDER_UNKNOWN`, and for the table presentation `TABLE_COLUMN_TYPE_NOT_ALLOWED`.

### 3.2 Addressing an instance's answer

```ts
type InstanceId = string; // branded, ins_..., session-scoped
type AnswerKey = `${QuestionId}` | `${InstanceId}/${QuestionId}`;
type AnswerMap = ReadonlyMap<AnswerKey, AnswerValue>; // was ReadonlyMap<QuestionId, AnswerValue>
```

A question outside every group keeps the bare `questionId` as its key, byte for byte. A question inside a group is keyed `ins_7k2/q_passport`. The separator is `/` because neither branded id may contain it, so the encoding is unambiguous and parseable without a schema. `AnswerMap`'s type widens from `QuestionId` to `AnswerKey`; every existing call site compiles, because `QuestionId` is a member of `AnswerKey`.

**The roster is the third input, and it is separate from the answers.** `evaluateRules` gains an optional fourth parameter:

```ts
evaluateRules(
  snapshot: FrozenSnapshot | FormDefinition,
  answers: AnswerMap,
  resolveQuestion: ResolveQuestion,
  rosters?: ReadonlyMap<GroupId, readonly InstanceId[]>,   // live instances, in roster order
): Result<FlowState, EvalError>
```

Omitted, it is the empty map, so every existing caller compiles and every existing form evaluates identically. The roster is passed in rather than derived from the answer keys, and that is the important choice: derived from answers, an instance the respondent added and has not yet answered would not exist, so "Add passenger" would do nothing visible and a reload would lose the empty card. The roster is state the server owns; section 5 gives it a home.

**Determinism (I7) is preserved and its statement widens.** Today it is "same `(snapshot, answers)` gives the same `FlowState`, forever". It becomes "same `(snapshot, answers, rosters)`", with roster order stored rather than computed. The roster is an ordered list, and order is meaning, which is a first for the kernel: `multiChoice` is the only array value today and ADR-21 makes its comparison **set** equality precisely because its order is not meaning. Roster order is meaning and is never set-compared.

### 3.3 Validation

`validateAnswer(question, value)` is **unchanged**. It takes a question and a value and knows nothing about where the question sits, which is exactly why T2 works: a cell is validated by the same function as any other answer, returns the same `{code, constraint, message}` errors, and refuses `""` and `[]` with `EMPTY_ANSWER_NOT_ALLOWED` per cell.

- **"Empty is absence" per instance.** An instance's question is answered when the map holds a non-blank value at that instance's key. `isBlankAnswerValue` stays type-blind and untouched.
- **"Empty is absence" for the group.** An instance with no non-blank answers at all is still a **live instance**, because the roster says so. That is the deliberate difference from a derived roster, and it is what makes "Add passenger" a thing the respondent can see happen.
- **Required, per instance.** A question marked `required` in its pinned definition is required in **every live instance** of its group. The I9 sweep in `prepareSubmission` therefore reports one `MISSING_REQUIRED` per `(instance, question)` rather than one per question.
- **`min` and `max` at submit.** A group whose live instance count is below `min` or above `max` is a new submission error, `REPEAT_COUNT_OUT_OF_RANGE`, carrying the group and the count. It is a submission error and not a validation error because it is a property of the session's roster, not of any one value.

### 3.4 The rules DSL

Two things happen, and only one of them grows the closed operator set.

**Scope is implicit, by position.** A rule whose `show` target is a question inside group G is evaluated **once per live instance of G**. Inside that evaluation, a reference to a question that is also inside G resolves to **that instance's** answer; a reference to a question outside G resolves normally. No syntax changes for this case, so the airline's "this passenger is an infant, show this passenger's fare basis" rule is written exactly as an ordinary rule is written today. The admin states the scope on the rule rather than making the author encode it (section 6).

**Two new operators**, for the outside-in direction, which has no implicit reading:

```ts
| { op: "anyInstance"; groupId: GroupId; condition: Condition }
| { op: "instanceCount"; groupId: GroupId; compare: "equals" | "gt" | "gte" | "lt" | "lte"; value: number }
```

`anyInstance` is true when its nested condition holds for at least one live instance, with references inside that condition resolving per instance. `instanceCount` compares the live instance count, reusing the **names** of the existing comparison operators as a field rather than introducing a second comparison vocabulary.

**Three operators were considered and one was cut.** `everyInstance` is not proposed, for two reasons. It is expressible as `not(anyInstance(not(c)))`, combined with `instanceCount gte 1` when the author does not want the vacuous reading. And its vacuous reading is a trap: "every passenger holds a passport" is true of a group with no passengers, which is the opposite of what an author writing that sentence means. Leaving it out makes the author write the count check they meant. Q7 puts the choice to the Code Owner.

**What the new operators cost, which is more than two union members.** ADR-03's own Note names the machinery: `packages/core/src/visibility-rule.test.ts` pins the thirteen operators as a hand-edited list checked against the `Condition` union in both directions, and `apps/admin/lib/forms/condition.ts` ties the admin's parallel copy to the same union through a type-only import, "so neither side can move alone". Two new operators therefore mean a deliberate edit to that test, a matching edit to the admin's list, a changeset, and this ADR conversation. ADR-03 also says new operators are versioned core changes, and its second Note records that there is still no DSL version constant, so "versioned" stays a review convention.

**Depth.** `CONDITION_MAX_DEPTH` stays 8 and `anyInstance`'s nested condition counts toward it, which `conditionDepth` reaches by recursing into the new node like it recurses into `not`.

**Forward-only (ADR-16, I10) with a group in it.** `documentOrder` expands a group into a contiguous span of its member questions, in order. Three rules follow, all enforced by `analyzeRuleGraph` with existing error codes where the existing code fits:

1. A rule targeting inside G may read questions before G and questions earlier **within the same instance**. A reference to a later position inside the instance is `RULE_BACKWARD_TARGET` exactly as it is today.
2. A rule using `anyInstance` or `instanceCount` over G reads **the whole of G**, so its targets must appear strictly after G's whole span. This is the existing rule applied to a span rather than a position.
3. A `fromAnswer` count source is a read of its count question by the whole group, so the count question must precede the group's span. `REPEAT_COUNT_BACKWARD_REF`.

No rule may read a **different** instance of the same group. That is not a restriction the design chose so much as one the forward pass requires: instance order is a roster order and not a document order, so "the previous passenger's answer" has no forward-only reading.

**Cost bound, stated because a loop is where a forward pass stops being obviously cheap.** One pass still. The outer walk is over steps; a group's span is walked once per live instance. Condition evaluations are bounded by `rules x max(instances)`, with no nesting (section 2.5) and a hard instance ceiling (Q14). At the recommended ceiling of 100 instances and the depth cap of 8, the worst case is small and bounded at publish rather than at runtime, which is the property ADR-16 exists to protect.

### 3.5 `FlowState`, and the one place additivity is awkward

`FlowState` is a `z.object` and it is what every golden scenario's `expected` block asserts with `toEqual`. Widening `visibleSteps` from `StepId[]` to `{stepId, instanceId}[]`, or `missingRequired` from `QuestionId[]` to `{questionId, instanceId}[]`, would fail all forty-four committed scenarios and would need the `SEMANTICS_VERSION` bump that cannot be taken.

**Recommendation: every new field is optional and is omitted entirely when the form holds no repeating group.** The existing five fields keep their exact shapes and their exact contents for a form with no group.

| Field                                         | Today                    | With groups                                                                                         |
| --------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------- |
| `visible`                                     | `{stepId, questionId}[]` | gains an optional `instanceId`, present only on a repeated entry                                    |
| `visibleSteps`                                | `StepId[]`               | unchanged; a `perInstanceStep` group's pages are in the new field below                             |
| `currentStep`                                 | `StepId \| null`         | unchanged                                                                                           |
| `answeredRequired`, `missingRequired`         | `QuestionId[]`           | unchanged; they list a repeated question **once**, and the per-instance detail is in the new fields |
| `visibleStepViews` _(new, optional)_          | absent                   | `{stepId, instanceId: InstanceId \| null}[]`, the ADR-28 cursor's real page list                    |
| `missingRequiredInstances` _(new, optional)_  | absent                   | `{questionId, instanceId}[]`, document then roster order                                            |
| `answeredRequiredInstances` _(new, optional)_ | absent                   | the same shape                                                                                      |
| `rosters` _(new, optional)_                   | absent                   | `{groupId, instances: InstanceId[]}[]`, the live roster the evaluation used                         |

This is the ugliest part of the design and the plan says so rather than hiding it: two parallel arrays exist because one of them cannot change shape. The alternative is honest and is put to the Code Owner as **Q8**: build multi-version evaluation first, bump `SEMANTICS_VERSION` to 2, and widen the fields properly. That is a larger, separate piece of work with its own value (it unblocks every future semantics change, which ADR-16's Note calls out as the standing limitation), and it would make this design cleaner. The recommendation is to take the parallel fields now and record the tidy-up as the first thing multi-version evaluation buys.

### 3.6 Removal, and why it reuses a semantic that already exists

A removed instance is **not deleted**. Its answers stay in the append-only ledger, and the roster records that it was removed. For every purpose downstream of the ledger it behaves exactly like a **hidden** question does under invariant I6: excluded from all subsequent condition evaluation, excluded from the locked submission, excluded from the reporting view, not counted against completeness. The audit story is the one ADR-33 and I6 already tell: the ledger shows what was answered and when it changed, and the locked set shows what the answer set was at submission.

The same treatment covers a **shrinking count**. If a `fromAnswer` group's count question moves from 3 to 2, instance 3 becomes not-live. Its answers are excluded, not erased, and raising the count back to 3 **re-lives the same instance with its answers intact**, because the id never changed. That is a respondent-visible property worth naming: a mis-typed count does not destroy an answer.

---

## 4. Portal, rendering and the compiler

### 4.1 The compiler stays answer-blind, and that decides the shape

`compileFormWith` maps `definition.steps` to documents one for one, and it is pure and knows no answers: `StepResolverContext` carries the snapshot, the locale and the resolvers, and nothing else (ADR-14's Note already records that an answer-adaptive resolver would need a widened seam). An instance count is answer-dependent, so **the compiler cannot expand a group**. It emits a **template**:

```jsonc
{
  "type": "RepeatGroup",
  "props": {
    "groupId": "grp_passengers",
    "instanceLabel": "Passenger {n}",
    "presentation": "stacked",
    "min": 1,
    "max": 9,
    "addLabel": "...",
    "removeLabel": "...",
  },
  "children": [/* one control node per member question, name = the bare questionId */],
}
```

`RepeatGroup` is a **qcms-owned node type**, not an `@a2ra/core` registry component, and it follows the precedent the honeypot set (`HONEYPOT_NODE_TYPE`, documented in `docs/a2ui-mapping.md` and carried in the renderer-compat contract). Expansion is a **render-time clone**, which is the precedent `withNativeSubmit` and `documentForVisible` already set: the stored bytes are never touched, so ADR-18's "serve the stored audit copy" holds exactly.

The renderer clones the template once per live instance, in roster order, and rewrites each cloned control's `name` from `q_passport` to `ins_7k2/q_passport`. The roster reaches the renderer from the API's step projection, beside `values` and `flowState`, because the API is the only rule evaluator (R2).

**`name` is a contract shared by ten places, and instance-qualified names touch all of them.** It is set by the compiler's `baseControlProps`, passed straight through by every adapter, and read by `documentForVisible`'s pruning ("a node is a question control iff it carries a string `name` prop"), `commitMoments`, the `FieldBlur` wrapper's `id` and `data-qcms-field`, the adapter's `key`, the `__qk__` and `__qa__` field markers, the BFF decoder, the `qcms_step_ctx` cookie's three question-keyed records, and the error summary's `#` anchors. The plan's answer is that **the qualified name is the field's whole identity everywhere below the API**, so none of those ten places learns about instances; each keeps keying on one opaque string.

**The separator.** `ins_7k2/q_passport` uses `/`, which no branded id may contain, so the encoding parses without a schema. It is a legal HTML `id` and a legal fragment, and it needs `CSS.escape` in a selector, which the shared jsdom setup already polyfills for react-aria. Q15 puts the choice to the Code Owner, with `__` as the alternative that needs no escaping and no new rule about what a branded id may hold.

### 4.2 The no-JS path

This is the hardest part of the design, because nothing in the portal handles a non-submit action button today, and the no-JS claim in `docs/portal-constraints.md` is unqualified with an empty exception list.

**The mechanism is a named submit button.** A `<button name value>` contributes its name and value to the form data set **only when it is the button that submitted the form**, which is what lets one form carry several distinct operations without scripting. So the step form gains:

```html
<button type="submit" name="__qop" value="add:grp_passengers">Add passenger</button>
<button type="submit" name="__qop" value="remove:grp_passengers:ins_7k2">Remove passenger 2</button>
```

The whole-step POST therefore carries every field on the step **plus at most one `__qop` value**. The BFF's `decodeStepForm` gains a fourth reserved prefix beside `__qk__`, `__qa__` and the honeypot's `website`, and the step route applies the answers first and the roster operation second, so an add never loses what the respondent had already typed. The response is the same 303 back to `/s/{sessionId}` the route already does, with a fragment naming the instance to focus.

**The Add and Remove buttons carry `formnovalidate`, and that is not a detail.** Every other control on the step keeps browser validation, which is the Code Owner's 2026-09-13 ruling on issue #920. But a respondent who has filled passenger 1 and wants passenger 2 would be refused by the browser for passenger 1's blank passport, and pressing Add would do nothing with nothing said, which is the class of dead end that issues #920, #18 and #988 each closed once. `formnovalidate` is a submit-button attribute in the HTML standard for exactly this, so the Add and Remove buttons submit unvalidated, the API refuses nothing it would not refuse anyway, and the step comes back with the API's own report through the path issue #920 built.

**No repeated field names.** The decoder's `partition()` already accumulates a repeated name into a `string[]`, but only the `multi` kind consumes more than `raws[0]`, and relying on duplicate-name ordering would couple the wire to DOM order, which a removal reorders. The HTML standard is firm that entries are built "in tree order" and that order survives serialisation, but it is firm **per name only**: an unchecked checkbox and an unselected radio contribute no entry at all, so one column's list runs short of another's and positional zipping across columns is unsafe. The spec offers no indexing mechanism, which makes indexed names an application convention either way. Every instance's field therefore carries a unique qualified name, and the decoder needs no ordering rule at all.

**One call per answer is not acceptable at nine passengers.** `forwardAnswers` makes one `POST /sessions/{id}/answers` per decoded answer, sequentially, and each one takes a per-session advisory lock and re-evaluates the flow. Nine passengers times six questions is fifty-four round trips for one Continue. Q20 proposes a batch answer endpoint for this reason; it is an internal contract with no stability promise, and the batch is also what makes the roster operation and the answers one transaction.

**The re-render cookie will not hold.** `qcms_step_ctx` is one JSON cookie, 15 seconds, carrying `values`, `errors`, `constraints` and `missingRequired`, all keyed by question. Browsers cap a cookie at roughly 4 KB. A nine-passenger step with an error on each instance exceeds that, and a cookie that silently fails to set produces a re-render with the respondent's answers missing, which is the worst failure this document can name. Q21 proposes that a repeat form's re-render take `values` and `missingRequired` from the API's own projection (it already returns both) and keep only the 422 constraint errors in the cookie, with a hard cap and a documented overflow behaviour.

### 4.3 Accessibility

The floor is WCAG 2.2 AA and the portal's manual screen-reader pass (task 030) is a Code Owner human gate. Section 13 records the sources.

- **Instance grouping.** Each instance is a `<fieldset>` whose `<legend>` carries the resolved instance label, with the same text as a heading inside it so the instance is reachable by heading navigation as well as by group. This is the WAI forms tutorial's own worked example (two same-shaped address blocks distinguished by their legends) and technique H71's rule of thumb: a group inside a larger form that needs a heading of its own. **The legend stays short**, because the tutorial warns that some screen readers read the legend with every control in the group, and each control's own label stays self-explanatory for the configurations that never read it. 1.3.1 Info and Relationships, 2.4.6 Headings and Labels.
- **Focus after add.** Focus moves to the new instance's heading, which carries `tabindex="-1"`. Without scripting the same landing is reached by the 303's fragment. 2.4.3 Focus Order.
- **Focus after remove: the following instance, not the Add button.** APG's keyboard-interface practice names the destination in terms, for exactly this case: after "a destructive operation like deleting an item from a list", focus goes to "the list item following the deleted item", and its reasoning is the screen-reader one, that hearing the next item confirms the deletion and makes a second deletion efficient. So focus lands on the heading of the instance that took the removed one's position, and on the Add button only when the removed instance was the last. **An earlier draft of this plan recommended the Add button in every case and was wrong.** Two gaps are worth stating rather than papering over: APG addresses a scripted DOM removal and says nothing about the last-item case, and **no source found addresses focus after a full-page POST-redirect-GET**, so the no-JS landing (the fragment) is a design decision this plan takes rather than a citation it makes.
- **Announcement, on one path only.** With scripting, a `role="status"` region says "Passenger 3 added" and "Passenger 2 removed, 2 passengers remaining", written as the whole sentence rather than as a changing number, because 4.1.3's own Understanding warns that updating only the digit in "3 items" can announce just "three". Without scripting, **4.1.3 does not apply**: the criterion explicitly scopes out messages "delivered via a change in context", and a whole-page POST and re-render is a change of context that assistive technology already surfaces. So the no-JS path needs no live region, and that is a citation rather than an omission.
- **Error summary naming the instance.** The existing summary is a `role="alert"` block of in-page anchors keyed by question. Each entry gains the instance label: "Passenger 2: passport number is required", anchored at the qualified field id. 3.3.1 Error Identification, with 3.3.3 Error Suggestion where the constraint has one.
- **Naming the per-instance controls.** APG's naming practice says to put the distinguishing words first, so the control is named **"Remove passenger 3"** and never "Passenger 3 remove".
- **No dragging.** Instances are not reorderable at launch. If reordering is ever added it needs a single-pointer non-dragging path (2.5.7 Dragging Movements), which is the criterion issue #680 already caught the admin's option grid on.
- **Target size.** Add and Remove are controls at the portal's `--space-control-h` floor of 44px, above 2.5.8's 24px minimum, and a per-row Remove in the table presentation is the control most likely to fall below it.
- **Focus not obscured (2.4.11).** New at 2.2, and it bears here through **sticky table headers and a sticky column-total footer**, which are exactly the "sticky footers, sticky headers" its Understanding names. A table presentation that pins its header row has to prove a focused cell in the first visible row is not hidden by it.
- **Redundant entry (3.3.7)**, new at 2.2, bears twice. It is the criterion an author violates by splitting a group across two steps and asking for the same passenger twice. And it bears on the round trip itself: the criterion covers information "required to be entered again in the same process", so a POST that came back having lost the other instances' answers is a conformance failure and not only a bad experience.
- **On input (3.2.2)** decides one small thing. An explicit **Add another** button is outside the criterion, because activating a button is not changing a setting. A count `<select>` that submitted on change would be inside it, which is one more reason the count question is an ordinary question answered with an ordinary Continue.
- **Two of the new 2.2 criteria do not bear, and are listed so a reviewer does not look for them.** 3.3.8 Accessible Authentication applies to authentication steps only. 3.2.6 Consistent Help governs help mechanisms repeated across a page set and its Understanding is explicit that it is "distinct from ... instructional text in a form"; it binds the step chrome's ordering across re-renders and nothing inside the group.

### 4.4 The table presentation

**Use a native `<table>`, not `role="grid"`.** Three of the four reasons are citable and the fourth is this product's own.

1. **A grid cannot exist without scripting.** APG states it as a defining property of the pattern: a grid "Requires the author to provide code that manages focus movement inside it", and only one of its focusable elements is in the page tab sequence. With scripting off there is no roving tabindex, so a `role="grid"` renders as a tab-trap-shaped nothing. For a surface whose no-JS claim is unqualified, that settles it on its own.
2. **APG prefers the native element.** "As with other WAI-ARIA roles that have a native host language equivalent, authors are strongly encouraged to use a native HTML `table` element whenever possible."
3. **APG's two optimal cell designs exclude a text input.** The optimal pairs are a cell holding one widget that does not need arrow keys (link, button, menubutton, toggle button, radio button, switch, checkbox) with focus on the widget, or a cell holding text or one graphic with focus on the cell. A text field is "editable content", which APG routes through an Enter/F2/Escape edit mode, and it warns that cells outside the two patterns "add complexity for authors or users or both". A four-column assets table is three text-ish columns.
4. **A phone has no grid.** The table reflows to cards at 390px, and a keyboard model that exists only above the reflow width is two interaction models for one question.

**What the table pattern costs, stated as APG states it**, so that nobody reads it later as a defect: "Since a table is not a widget, each widget contained in a table is a separate stop in the page tab sequence", and a grid is what you reach for when "the number of widgets is large". A four-column table of ten rows is forty tab stops. That is the documented, expected behaviour of the choice, and the mitigation is the group's `max` rather than a different pattern. Q10 puts the whole trade to the Code Owner and section 13 carries the sources.

Structure:

- `<table>` with a `<caption>` carrying the group label.
- `<th scope="col">` per column, the column label being the member question's own label.
- `<th scope="row">` per row carrying the resolved instance label ("Asset 3").
- **Every input carries its own label**, visually hidden, reading "Asset 3, Value AUD". Two reasons, and the second is the one that is easy to get wrong.
  - **`scope` and `headers` do not name a control.** They associate a **cell** with its header cells, which serves 1.3.1 for the table's structure. No source found claims they contribute to the **input's** accessible name, and the input is what a respondent's assistive technology is on when they type. Technique H44 (a `<label for>`, visible or hidden) and APG's naming practice ("Prefer Native Techniques ... the HTML `label` element for form elements") are what name it.
  - **The reflow removes the headers.** At 390px the table becomes one card per row, the header cells stop being headers, and any name that came from a header relationship goes with them. A real label per cell is the only encoding that survives both layouts, so the plan takes it in both rather than switching at a breakpoint. The WAI tables tutorial asks for exactly this: "On small screens ... responsive tables often change format. Ensure that the structural relationship is available in all formats."
  - **One documented gap, recorded rather than argued around.** H44 says a hidden label satisfies 1.3.1 and 4.1.2 but that for 3.3.2 Labels or Instructions "the label element must be visible". No W3C source found states that a visible `<th>` column header discharges 3.3.2 for the input in the cell beneath it. The inference is reasonable and it is not written down anywhere, so the plan states it as an inference: above the reflow the visible column and row headers are what a sighted respondent reads, and below it the card layout makes the label visible outright. Task 030's manual screen-reader pass is where that inference is tested rather than asserted.
- A `<tfoot>` row for a column total, which is computed presentation and is never an input and never an answer.
- Above the reflow width the table lives in its own `overflow-x: auto` box, which is the only element on a portal page permitted to scroll horizontally.

The table presentation constrains the column types (Q12): recommended `shortText`, `number`, `date`, `boolean` and `singleChoice`. `longText` and `multiChoice` are refused at publish with `TABLE_COLUMN_TYPE_NOT_ALLOWED`, because neither fits a cell and the phone card reflow makes both worse, and an author who wants them has the stacked presentation.

**A vendored `Table` already exists** in `packages/ui/src/components/a2ui/table/` and is exported from the admin Kit, but it is not in the renderer registry and is a read-only display table. It is the right starting point for the markup and the style map, and it is not an input grid.

**One implementation trap, found while building the concept pages rather than reasoned about.** A visually hidden label positioned with `position: absolute` inside an `overflow-x: auto` box resolves against the initial containing block when no ancestor is positioned, so it lands past the viewport edge and widens the **document**, producing exactly the horizontal page scroll the portal forbids. It cost 136 unexplained pixels on one concept page. The fix is one declaration, `position: relative` on the scroll box and on any button carrying a hidden label, and it is worth a paragraph here because this design puts a hidden label in **every** cell, so the trap is structural rather than incidental. A second one from the same build: when an instance card's border is on the `<fieldset>`, the `<legend>` renders in the fieldset's legend slot and cuts the border; `float: left; width: 100%` puts the heading inside the card while `<legend>` stays the fieldset's accessible name.

### 4.5 Mobile

`playwright.config.ts` runs **every** spec on the Pixel 7 project, so mobile is not a viewport a repeat spec opts into. The stacked presentation is already one card per instance and needs nothing. The table reflows to cards. The `perInstanceStep` presentation is the one that is best on a phone and the one to recommend to an author with a wide group.

---

## 5. Storage and data flow

### 5.1 `answers`

One nullable column: `instance_id text NULL`. The current-value rule becomes latest per `(question_id, instance_id)`, which is one more key in `latestAnswers`'s `DISTINCT ON`, and the index `answers_session_question_answered_at_idx` gains `instance_id` before `answered_at`. Everything else is untouched:

- `answers_reject_update` and `answers_reject_delete` are unchanged and now cover the new column by construction.
- `answers_retraction_value` is unchanged: a retraction is per `(question, instance)`, which is exactly what a cell clear needs.
- `question_id` keeps its deliberate absence of a foreign key.
- The hand-kept `AnswerRow` type and its `_AnswerRowMatchesTable` guard (issue #5) move in the same change.

**The value is never touched.** Migration 0009's own rationale is the precedent and it is worth quoting to anyone tempted otherwise: a sentinel inside the `value` JSON was rejected because "it could collide with author-supplied content and would force every reader to sniff for it". An instance index encoded inside `value`, or inside `question_id`, is the same mistake.

### 5.2 The roster

A new append-only table in the data plane:

```
answer_group_instances
  id            uuid PK
  session_id    text NOT NULL -> sessions.session_id
  group_id      text NOT NULL          -- no FK; it names a group pinned in the session's form version
  instance_id   text NOT NULL
  event         text NOT NULL          -- 'added' | 'removed'
  occurred_at   timestamptz NOT NULL DEFAULT now()
```

The live roster is every `instance_id` whose latest event is `added`, ordered by its first `added` row. Removal appends; nothing updates and nothing deletes. Two triggers mirror the ledger's (`answer_group_instances_reject_update`, `..._reject_delete`, the delete one honouring the same `qcms.allow_answer_delete` door), a CHECK pins the event vocabulary, and one index serves the roster read.

**Why a table and not an answer.** Encoding the roster as a synthetic answer keyed by the group id would reuse the existing table and its triggers, and it was considered. It is rejected because `answers.question_id` would then hold something that is not a `questionId`, which collides with `prepareSubmission`'s `UNKNOWN_QUESTION` ledger-drift defence, with R6's statement about what a `questionId` is, and with the reporting view's contract that a row is a question. Q16 records the trade.

**Consequences that are easy to lose:**

- `migrations.test.ts`'s `EXPECTED_TABLES` is an **exact** set since issue #861, so the new table is added there or the suite fails.
- `eraseSession` gains a delete of this table inside the same transaction and behind the same door, and `purgeExpired` gains the same. An erasure that leaves a roster behind leaves the shape of a respondent's family.
- ADR-40's per-environment generator grows: the twelve guards become **fifteen** (two triggers plus one CHECK) and the seven foreign keys become **eight**. That is a Note on ADR-40 and a line in task 064's table, proposed here and written by whichever task lands second.
- The two trigger functions stay single in `control`, as ADR-40 already specifies for the answer ledger's pair.

### 5.3 Submission and the locked set

`LockedAnswer` gains an optional `instanceId`:

```ts
type LockedAnswer = { questionId: QuestionId; instanceId?: InstanceId; value: AnswerValue };
```

Ordering is document order for questions and roster order for instances, and `canonicalJson` already preserves array order, with its own doc saying order is meaning. A form with no group produces a byte-identical `LockedSubmission` and therefore a byte-identical `contentHash`, which the committed insurance golden hash asserts for free.

`prepareSubmission` gains `REPEAT_COUNT_OUT_OF_RANGE` and reports `MISSING_REQUIRED` per `(instance, question)`.

**Issue #968 is amplified and should be closed first.** That open issue records that the required-answer sweep runs before the session lock, so a concurrent retraction can leave the ledger and the submission out of step. A repeat multiplies the window by the number of fields a step posts, and the no-JS path posts a whole step at once. The task breakdown makes closing #968 a dependency rather than a discovery.

### 5.4 The webhook and the outbox, including the redacted form

**Repeated answers stay inside the `answers` member of the payload, and this is not a stylistic preference.** Erasure and the retention sweep both redact by dropping exactly one jsonb key, `payload - 'answers'`, and migration 0016's CHECK `outbox_redacted_payload_has_no_answers` enforces that a redacted payload holds no `answers` key. A design that put repeated content in a sibling member (`groups`, `rows`, `instances`) would escape both the redaction and the CHECK, silently, and the first anyone would know is a subject-access request answered with data that was supposed to be erased.

So the payload's `answers` becomes `LockedAnswer[]` with the optional `instanceId`, exactly as the locked set is. Nothing else in the envelope changes, the HMAC signing is unchanged, and `docs/webhooks.md` gains an example.

**The redacted payload carries nothing new.** No instance ids, no roster, and **no counts**. A count is not an answer, but "how many dependants", "how many liabilities" and "how many passengers" are disclosive on their own, and the CHECK's guarantee is cheapest to keep as "the payload after redaction holds no respondent-derived value of any kind". Q19 records it as a decision rather than an omission.

### 5.5 CSV export

`questionIdsInDocumentOrder` is built on a premise the code states out loud: "A questionId is pinned at most once across a form (a parse invariant), so the result is duplicate-free." That premise survives (section 3.1 keeps the refinement), but one column per question does not: an open-ended group has no column count until the data is read, and a column set that depends on the data rather than on the form version is not a contract a consumer can bind to.

**Recommendation: keep the wide file, add one long file per group.**

- `responses.csv` is unchanged for every question outside a group, with the same metadata columns, the same document order, the same BOM and CRLF, and the same golden byte test.
- One extra file per repeating group, named for the group: `session_id, instance_ordinal, instance_id, <one column per member question in document order>`, one row per `(session, live instance)`.
- A form with at least one group exports as a zip of those files; a form with none exports exactly the single file it exports today, so no existing adopter's pipeline moves.
- `@roonga/qcms-csv`'s formula-injection guard (issue #470) and the `;` join for multiChoice apply unchanged in the new files.

The alternative, indexed wide columns (`q_passport__1` through `q_passport__9`), is recorded in Q17 with what it costs: the column count becomes the group's `max` rather than its data, an open-ended group with `max: 500` produces 500 mostly-empty columns, and a group whose `max` is raised in a later form version silently changes the header of an export somebody automated.

### 5.6 Reporting view

The current SQL is the sharpest single collision in the whole design:

```sql
jsonb_object_agg("elem"."item" ->> 'questionId', "elem"."item" -> 'value')
```

Two locked answers for one `questionId` is exactly what a repeated question produces, and `jsonb_object_agg` **silently keeps one**. There is no error and no warning. Changing it is not optional.

- **`reporting.answers_flat`** gains a nullable `instance_id` column and its grain becomes `(session, questionId, instanceId)`. Appending a column is a **minor** `@roonga/qcms-db` release under the documented stability promise, and a consumer selecting explicit columns is unaffected.
- **`reporting.responses.answers`** keeps `questionId -> value` for every question outside a group, and gains one key per group id whose value is an ordered array of objects, each `{instance_id, <questionId>: value, ...}`. A form with no group produces a byte-identical `answers` object, so the change is additive in fact and not only in principle.
- The drift test that asserts the live view column list against `docs/reporting-view.md` moves in the same change, and so does the doc.
- Under ADR-40 the views are per environment and, after task 068, per workspace, so this change is applied to the view **generator** rather than to a literal list.

### 5.7 Erasure, retention and PII

`docs/SECURITY_DESIGN.md` states the stance that makes this section short: "all answer content is treated as PII regardless of question semantics, no classification guesswork". A passport number is not more PII than a meal preference, in the model; it is the same PII, more of it.

- **Erasure already reaches everything**, because it is session-scoped: it deletes the session's answers and submission behind the `qcms.allow_answer_delete` door, cancels undelivered deliveries, redacts delivery snippets and outbox payloads, and writes a tombstone. Repetition adds one table to the delete list (5.2) and nothing else. The tombstone shape is unchanged: it records existence, not content, and it has no idea how many passengers there were.
- **Retention purge** gains the same table.
- **What genuinely changes is the volume.** A nine-passenger booking holds nine names, nine dates of birth and nine passport numbers in one session, so one erasure request and one retention miss are both nine times as consequential. That is an argument for the caps in section 8 and for nothing else in the model.
- **SEC-13 redaction is unchanged and already correct.** The span and log allowlists permit branded ids as pseudonymous correlators and delete everything unlisted, so `ins_` joins `q_`, `frm_`, `stp_` and `ses_` as a permitted correlator and no value follows it. The logger's own test asserts that `answer` and `answerValue` fields do not survive; nothing about a repeat changes what that asserts.

---

## 6. Authoring

### 6.1 The question editor does not change

A question does not know it is repeated. `QUESTION_TYPES` is unchanged, `ConstraintsView` is unchanged, `QuestionDefinitionView` is unchanged, the option grid is unchanged, and `scripts/component-registration.test.ts`'s eight registration sites are unchanged, because no component is registered. That is the single largest practical dividend of recommending T2 over T1, and it is worth stating where an implementer will look for it.

### 6.2 The form builder

`DraftStep.items` widens from `DraftPin[]` to a union with a draft group, mirroring the kernel. The pure mutations in `apps/admin/lib/forms/draft.ts` gain the group operations (`addGroup`, `removeGroup`, `addPinToGroup`, `movePinWithinGroup`, `setGroupCount`, `setGroupPresentation`), following the file's existing shape: the component holds the draft and every mutation is a pure function tested on its own.

The group panel carries, in this order: name and group id, the member question list (the same ownership grid the step editor already draws, so form-owned cells get controls and library-owned cells are text), the count source as a three-way radio with a question picker for `fromAnswer`, `min` and `max`, the instance label template with a live preview, and the presentation as a three-way radio.

`step-editor.tsx` and `lib/forms/pin-grid.ts` gain group boundaries in the grid. `rail-steps.tsx` and `lib/forms/subtree-rail.ts` gain a group node in the rail tree.

### 6.3 The table question editor

Under T2 there is no table question, so the "column editor" is the group's member list rendered as columns: each row is a column, showing the column label, the underlying question and its type, with the type shown rather than chosen (it is the question's own type). Adding a column is adding a question to the group; the picker filters the library to the allowed cell types (Q12) and says why the others are absent. The whole editor is therefore a second view of one list, which is what keeps the author's two mental models (a group and a table) from becoming two data models.

### 6.4 The rules editor and the test bench

- **Scope is shown, not authored.** When a rule's target sits inside a group, the editor states it on the rule: a chip reading "evaluated per passenger", using the group's label. The author writes an ordinary condition. `lib/forms/rule-sentence.ts` gains the sentence forms.
- **The two new operators get structured editors.** `anyInstance` is a group picker plus a nested condition, reusing the existing nested-condition editor and its depth accounting. `instanceCount` is a group picker, a comparison picker and a number.
- **`apps/admin/lib/forms/condition.ts` moves in the same change or the admin fails to typecheck.** ADR-03's Note records why: the admin's parallel operator list is tied to the kernel's `Condition` union by a type-only import, which R2 permits because it is erased at compile time, and a new operator in core therefore breaks the admin's build. This is a feature and it is the reason the admin work cannot lag the kernel work by a PR.
- **`rule-targets.ts` and `eligibleTargets`** gain the forward-only rule over a span rather than a position (section 3.4).
- **The test bench** posts `{draft, ruleId, answers}` to the draft-preview endpoint and is evaluated server side. It gains an instance dimension: the author adds hypothetical instances, fills per-instance answers, and reads a per-instance match or no-match. That is the surface where an author finds out that a rule they wrote reads the whole group rather than one instance.

### 6.5 Preview

`draft-preview.tsx` composes the same three pieces the portal does: the API's `compileForm`, `documentForVisible`, and `A2UIStepRenderer`. A repeat expands at render time in the renderer, so the preview expands it the same way and by the same code, which is the property the preview's own docblock claims ("the preview's DOM for a step is the portal's DOM for that step, structurally, rather than by resemblance"). The preview needs a roster, and the recommendation is that the preview mints one locally from the draft's `min` (or from a count the author types) rather than reaching for session state it does not have.

---

## 7. Versioning and compatibility

| Stamp                     | Moves?          | Why                                                                                                                                                                                                                                         |
| ------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SEMANTICS_VERSION`       | **No, stays 1** | No published snapshot's evaluation changes. A form with no group produces a byte-identical `FlowState`. Bumping it is currently impossible without multi-version evaluation (section 3), and the whole design is built to avoid needing to. |
| `SNAPSHOT_SCHEMA_VERSION` | **Yes, 1 to 2** | Its own doc says to increment when the snapshot's shape changes, and `FormDefinition.steps[].items` changes shape.                                                                                                                          |
| `COMPILER_VERSION`        | **Yes**         | The compiler emits a node type it did not emit before.                                                                                                                                                                                      |
| `A2UI_SPEC_VERSION`       | **Yes**         | `RepeatGroup` is a new node type in the spec the renderer must keep compatible with forever (ADR-18).                                                                                                                                       |
| `@roonga/qcms-db`         | **Minor**       | Every reporting change is additive: a new nullable column and a new key that appears only for forms that have a group. A major would be a rename, a removal or a changed canonical encoding, and there is none.                             |
| `@roonga/qcms-core`       | **Minor**       | Additive schema, additive operators, a widened `AnswerMap` type every existing caller satisfies, and an optional fourth evaluator parameter.                                                                                                |

**Published forms.** Nothing moves. A published version is immutable (R1), its stored compiled documents are served verbatim (ADR-18), and a snapshot stamped `schemaVersion: 1` keeps parsing because every new field is optional or absent. A session pinned to an old version behaves exactly as it does today (ADR-07, I4).

**Ids.** `questionId` and `optionId` are untouched, so R6 and I8 are untouched. Two new id kinds appear: `grp_` is a **form-scoped** id, permanent within a form the way `stepId` is, and `ins_` is a **session-scoped** id that is never reused across sessions and never renumbered within one.

**Changing a form so that a question moves into or out of a group** is a change to the form, not to the question, so it produces a new form version and touches no published one. The question's own definition and version are unaffected, which is the property that lets the same library question be single in one form and repeated in another.

**Golden corpora, both of them, appended and never edited.**

- `packages/core/golden/evaluator/`: new scenario files for per-instance visibility, `anyInstance`, `instanceCount`, a removed instance's answers excluded, a shrinking `fromAnswer` count, and `min`/`max` at submit. Each needs a corpus-local form and, where a new question shape is wanted, a corpus-local question. **No existing `expected` block is edited**, which section 3 makes possible and `CORPUS.md` makes mandatory.
- `packages/a2ui-compiler/golden/`: the documented spec-bump procedure opens a new generation for the `A2UI_SPEC_VERSION` move, carrying the seven existing forms across unchanged plus new repeat and table forms. The append-only guard covers both trees and the `check:golden-append-only` script is what enforces it on every run.

**The template mirror.** `packages/create-qcms-app/templates/common/apps/api/src/features/responses/serve-step/handler.ts` is a byte-identical vendored copy of the API's answer write path, and `pnpm check:templates` fails when the two drift. Every task touching that handler carries the mirror.

---

## 8. Security and abuse

The controls are SEC-numbered where they extend an existing one and named as new where they do not. Nothing here edits `docs/SECURITY_DESIGN.md`; each item names the section a task would extend.

1. **Unbounded instance counts are the new abuse surface, and the design closes it at four levels.** `max` is required on an open-ended group (section 2.4), publish refuses a `max` above a core ceiling (`REPEAT_MAX_ABOVE_CEILING`, recommended 100 per group, Q14), the API refuses an add that would exceed the group's `max`, and a per-session total instance ceiling bounds a form that carries several groups. Without all four, an open-ended group is an authenticated-by-nothing insert loop into an append-only ledger, which is the one write path a respondent controls the size of.
2. **Payload size.** A whole-step POST with 100 instances times 6 fields is 600 fields and their two marker companions each. The step route needs a field-count limit and a body-size limit, refused with the existing error envelope rather than by the runtime. This extends the ADR-12 abuse baseline rather than adding a mechanism.
3. **Rate limits.** The answer endpoint is already rate limited per session and per IP. The roster operation is a distinct, cheaper-to-repeat action ("add" in a loop) and needs its own limit; under ADR-40 rate limits stay installation-wide (finding F6), so this is one more typed setting and not a per-environment one.
4. **Ledger growth per session** is now respondent-controlled rather than author-controlled. Retention is the backstop and is unchanged, but the sweep's cost model changes, which is worth measuring rather than asserting.
5. **The honeypot is per step and stays per step.** The compiler emits one decoy node per step document (ADR-12, the ADR-01 Note). A repeat must not clone it, which is a real risk given that expansion is a template clone: the honeypot node sits outside the `RepeatGroup` template, and a test should assert that a ten-instance step carries exactly one decoy.
6. **PII volume, not PII kind.** Section 5.7. The erasure path already reaches it; the caps are what keep the volume bounded.
7. **SEC-13 needs one addition and no exception**: `ins_` joins the permitted branded-id prefixes in the span and log allowlists as a pseudonymous correlator. No value, no count and no label follows it.
8. **The origin belt (SEC-9)** already covers the step POST and covers the roster operation with it, because the roster operation _is_ a step POST.
9. **Erasure's completeness claim** is only as good as its table list, and the list is hand-kept. Adding a table to the data plane without adding it to `eraseSession` is a silent gap, which is why section 12 makes it an exit criterion with an assertion rather than a deliverable with a checkbox.

---

## 9. Out of scope, and why

- **Nesting.** A group inside a group (section 2.5, Q13). Neither use case needs it and it changes an instance address from a pair to a path.
- **Reordering instances.** Moving passenger 3 above passenger 2. It buys nothing the ordinal does not already give, and it needs a single-pointer non-dragging path (WCAG 2.2 SC 2.5.7) plus an ordering column in the roster.
- **Cross-instance rule references.** "The previous passenger's surname." There is no forward-only reading of it (section 3.4).
- **Aggregate answers.** A "total value" question whose answer is computed from a column. Computation in the serving path is a new capability with its own determinism and audit story, and the column total in the table presentation is **presentation only**: it is drawn, never stored, never submitted, never exported. An author who needs the total stored asks for it as a question.
- **A distinct `table` question type** (section 2.3, Q3). Recorded as the rejected option with its full cost, so that a later reader knows it was weighed.
- **Copying an instance.** "Same as passenger 1, different name." A convenience that is a respondent-facing feature of its own.
- **Repeating a question across steps.** A group lives inside one step; `perInstanceStep` paginates that one step. A group spanning two steps is a different feature and would collide with WCAG 3.3.7 Redundant Entry rather than serve it.
- **Multi-version evaluation.** The prerequisite a proper `FlowState` widening would need (Q8). It is real work with its own value and it is not this.
- **Anything that changes an existing published form's behaviour.** Section 3's absolute rule.

---

## 10. Open questions for the Code Owner

Twenty-three, each with a recommendation. **Seven are ADR-sized** and are marked; section 10.1 drafts the ADR text a ruling on them would produce. The rest are decisions inside a design, and a ruling on them lands in a task rather than in the record.

| #   | Question                                                                          | Recommendation                                                            |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Q1  | Is repetition in scope, and where?                                                | **Phase 4, after task 038.**                                              |
| Q2  | One primitive with three presentations, or three mechanisms? **ADR**              | **One.**                                                                  |
| Q3  | Is the table a presentation or a distinct question type? **ADR**                  | **A presentation.**                                                       |
| Q4  | Which count sources ship, and is `max` required on open-ended?                    | **All three; `max` required.**                                            |
| Q5  | What happens to a removed instance's answers?                                     | **Excluded, never deleted; reuse I6.**                                    |
| Q6  | The instance label template and the ordinal.                                      | **`{n}` is the live ordinal; the id is never shown.**                     |
| Q7  | How many new rule operators? **ADR**                                              | **Two: `anyInstance` and `instanceCount`.**                               |
| Q8  | `FlowState`: parallel optional fields, or multi-version evaluation first? **ADR** | **Parallel optional fields now.**                                         |
| Q9  | The no-JS add and remove mechanism.                                               | **Named submit buttons carrying `formnovalidate`.**                       |
| Q10 | Table semantics: native `<table>` or `role="grid"`? **ADR**                       | **Native `<table>`.**                                                     |
| Q11 | Focus and announcement after add and remove.                                      | **Follow APG: the following instance; no live region on the no-JS path.** |
| Q12 | Which question types may be table columns?                                        | **shortText, number, date, boolean, singleChoice.**                       |
| Q13 | Nesting depth. **ADR**                                                            | **One. A group may not contain a group.**                                 |
| Q14 | Instance ceiling per group and per session.                                       | **100 per group, 200 per session, both in core.**                         |
| Q15 | The separator in a qualified answer key.                                          | **`/`.**                                                                  |
| Q16 | Roster storage: a new table, or inside `answers`? **ADR**                         | **A new append-only table.**                                              |
| Q17 | CSV export shape.                                                                 | **Long, one extra file per group, zipped.**                               |
| Q18 | How `reporting.responses.answers` represents a group.                             | **One key per group id holding an ordered array.**                        |
| Q19 | Does the redacted outbox payload carry instance counts?                           | **No.**                                                                   |
| Q20 | Does the answer endpoint gain a batch form?                                       | **Yes.**                                                                  |
| Q21 | The `qcms_step_ctx` cookie under N instances.                                     | **Take `values` and `missingRequired` from the API; cap the rest.**       |
| Q22 | How the ADR-28 cursor addresses a per-instance step page.                         | **`(stepId, instanceId)`, in `visibleStepViews`.**                        |
| Q23 | Which ADRs are created and which are amended.                                     | **Two new, nine amended or noted.**                                       |

**Q1. Is repetition in scope, and where?** Nothing in the record rules it in or out. It is absent from `docs/PROJECT_GOAL.md` section 5's exclusion list, absent from ARCHITECTURE section 12's reserved seams, and there is no open or closed issue about repeating groups, loops, matrices, rosters or a table question type. **Recommendation: Phase 4, dispatched after task 038, recorded in the ledger and in `docs/features/039-phase4-backlog.md` the way the file-upload question type already is** ("versioned core change + storage story ... recorded so it's a decision, not an omission"). _Options:_ rule it out and close the question; take it into launch (which would move a cut-line the document says is enforced at review). _Consequence of doing nothing:_ the next author who needs six passengers authors thirty-six questions, and that form is then a published version nobody can refactor (R1).

**Q2. One primitive with three presentations, or three mechanisms? (ADR-sized.)** **Recommendation: one.** A looping question is a group of one, a looping step is a presentation, a table is a presentation. _Options:_ three separate kernel concepts, which triples the addressing, storage, export and rules work and gives an author three things to learn that behave differently at the edges. _Consequence:_ under one primitive, a decision about instance ids or the no-JS mechanism is taken once; under three it is taken three times and drifts.

**Q3. Is the table a presentation, or a distinct question type? (ADR-sized.)** **Recommendation: a presentation.** Section 2.3 has the full cost of the alternative. The short version: a distinct type adds an `AnswerValue` member, breaks per-cell "empty is absence", per-cell validation and per-cell retraction, breaks the CSV and reporting grain, and lights up eight exhaustive switches plus the eight registration sites of `scripts/component-registration.test.ts`. _Options:_ a distinct `table` type, which is what an author asking for a "table question" will describe; a presentation, which is what the kernel can carry. _Consequence:_ the vocabulary cost of the recommendation is paid once in the admin's labelling; the cost of the alternative is paid forever in every layer below it.

**Q4. Which count sources ship, and is `max` required on open-ended?** **Recommendation: all three, with `max` required on `open` and publish refusing its absence.** _Options:_ ship `fixed` and `fromAnswer` first and add `open` later, which is a sequencing choice the task breakdown takes rather than a scope one; leave `max` optional, which makes an open group an unbounded respondent-controlled insert loop. _Consequence:_ a required `max` is one more field an author sets and the only thing standing between a form and section 8's first abuse case.

**Q5. What happens to a removed instance's answers?** **Recommendation: excluded exactly as a hidden question's answers are excluded (I6), never deleted.** _Options:_ delete them, which would be a third whole-session-adjacent delete path where ADR-17 says there are two, and which would lose the audit answer to "what was answered and when it changed"; exclude them, which reuses a semantic the kernel already has and already tests. _Consequence:_ a respondent who removes passenger 3 and adds one back gets a **new** instance with no answers, while the removed one's answers stay in the ledger and in no export. A respondent who lowers a count and raises it again gets the **same** instance with its answers intact, because nothing was removed.

**Q6. The instance label template and the ordinal.** **Recommendation: `instanceLabel: LocalizedText` with one `{n}` placeholder, `{n}` being the one-based live ordinal, recomputed after a removal; the `ins_` id is never shown to a respondent.** _Options:_ a stable ordinal that leaves a gap after a removal ("Passenger 1, Passenger 3"), which reads as a bug; no template, so the label is "Passengers 2", which is what a generic plural gives. _Consequence:_ the ordinal is presentation, so an export's `instance_ordinal` column is the ordinal **at submission** and the `instance_id` is what joins.

**Q7. How many new rule operators? (ADR-sized, ADR-03.)** **Recommendation: two, `anyInstance` and `instanceCount`.** _Options:_ three, adding `everyInstance`, whose vacuous truth over an empty group is a trap ("every passenger holds a passport" is true of no passengers) and which is expressible as `not(anyInstance(not(c)))`; one, dropping `instanceCount` and making authors express a count through a count question, which does not work for an open-ended group that has none; zero, by letting the existing comparison operators take a `groupId` in place of a `questionId`, which changes seven node shapes instead of adding two and breaks the admin's parallel copy in seven places. _Consequence:_ each operator costs an edit to `visibility-rule.test.ts`'s hand-spelled list, a matching edit to `apps/admin/lib/forms/condition.ts`, a structured editor, a sentence in `rule-sentence.ts`, a `checkValue` branch in `rule-graph.ts` and a golden scenario.

**Q8. `FlowState`: parallel optional fields, or multi-version evaluation first? (ADR-sized, ADR-16.)** **Recommendation: parallel optional fields now, and record the tidy-up as the first thing multi-version evaluation buys.** Section 3.5 has the table. _Options:_ build multi-version evaluation, bump `SEMANTICS_VERSION` to 2 and widen `visibleSteps`, `missingRequired` and `answeredRequired` properly, which is cleaner, unblocks every future semantics change, and is a separate piece of work with its own risk; take the parallel fields, which is additive, passes all forty-four golden scenarios unedited, and leaves `FlowState` carrying two arrays that mean nearly the same thing. _Consequence:_ this is the one place the design is ugly, and the plan would rather say so than produce a `FlowState` that looks tidy and cannot ship.

**Q9. The no-JS add and remove mechanism.** **Recommendation: named submit buttons (`name="__qop"`) carrying `formnovalidate`, with instance-qualified field names and no repeated names.** Section 4.2. _Options:_ over-provision blank instances up to `max` and let the respondent fill the ones they want, which posts `max` empty instances on every step and makes "how many passengers" unanswerable; a second `<form>` per instance, which cannot carry the step's other answers and would lose them on every add. _Consequence:_ `decodeStepForm` gains one reserved prefix and the step route gains one branch, and `docs/portal-constraints.md` is updated in the same change, its exception list still empty.

**Q10. Table semantics: native `<table>` or `role="grid"`? (ADR-sized, portal.)** **Recommendation: native `<table>`.** Section 4.4 has the four reasons and the cost. _Options:_ `role="grid"` with a roving tabindex, which APG says requires author code to manage focus and therefore cannot exist with scripting off; a native table, whose documented cost is one tab stop per cell. _Consequence:_ the tab-stop count is bounded by the group's `max` and the column count, which makes Q14's ceiling an accessibility control as well as an abuse one.

**Q11. Focus and announcement after add and remove.** **Recommendation: after add, the new instance's heading; after remove, the heading of the instance that took its place, falling back to the Add button when the removed one was last; a `role="status"` region on the scripted path only.** Section 4.3. _Options:_ the Add button in every case, which an earlier draft of this document recommended and which contradicts APG's stated destination; no focus move at all, which drops focus to the body on the scripted path. _Consequence:_ the no-JS landing is reached by a fragment in the 303, and no source covers focus after a POST-redirect-GET, so that half is a decision rather than a citation.

**Q12. Which question types may be table columns?** **Recommendation: `shortText`, `number`, `date`, `boolean`, `singleChoice`. Refuse `longText` and `multiChoice` at publish.** _Options:_ allow all seven, which puts a textarea and a checkbox group in a cell and makes the phone card reflow unreadable; allow fewer (drop `date`, whose native control is wide), which costs the assets table its acquisition date. _Consequence:_ an author who needs a long text or a multi-choice per row uses the stacked presentation, which the admin says at the point of refusal rather than in documentation.

**Q13. Nesting depth. (ADR-sized.)** **Recommendation: one. A repeating group may not contain a repeating group, refused at parse.** _Options:_ allow two, which is enough for "passengers, each with bags" and turns an instance address into a path, the evaluator's walk into a nested loop, the CSV grain into a tree and an error summary entry into "Passenger 2, Bag 3: weight is required"; allow arbitrary depth with a cap, which is the same cost with a larger number. _Consequence:_ lifting the cap later is a real change to addressing and export, not a constant, so the plan would rather the Code Owner say no deliberately than have the cap read as an oversight.

**Q14. Instance ceiling per group and per session.** **Recommendation: a group's `max` may not exceed 100, and one session may not hold more than 200 live instances across all groups. Both are core constants, both are publish-validated, and the API refuses an add that would cross either.** _Options:_ no ceiling, so a form is as safe as its least careful author; a lower ceiling, which would refuse a legitimate twenty-holding portfolio; a configurable ceiling, which is a typed setting whose safe value nobody knows. _Consequence:_ the number also bounds the tab-stop count in a table (Q10), the field count in a step POST (section 8) and the evaluator's per-instance walk (section 3.4), so it is one number doing four jobs and is worth choosing on purpose.

**Q15. The separator in a qualified answer key.** **Recommendation: `/`, as in `ins_7k2/q_passport`.** _Options:_ `/`, which no branded id contains, is a legal HTML `id` and fragment, and needs `CSS.escape` in a selector (already polyfilled for react-aria); `__`, which needs no escaping but adds a rule about what a branded id may hold and reads like the `__qk__` and `__qa__` marker prefixes; `.`, which is not usable in a CSS selector without escaping either and is worse in a fragment. _Consequence:_ whichever is chosen is baked into every stored `answers.instance_id` join, every field name, every DOM id and every error-summary anchor, so it is cheaper to choose than to change.

**Q16. Roster storage: a new table, or inside `answers`? (ADR-sized.)** **Recommendation: a new append-only table, `answer_group_instances`.** Section 5.2. _Options:_ a synthetic answer keyed by the group id, which reuses the existing triggers and erasure path for free and puts a non-`questionId` in `answers.question_id`, colliding with `UNKNOWN_QUESTION`, with R6's statement of what a `questionId` is, and with the reporting contract that a row is a question; a new table, which costs two triggers, a CHECK, an index, a foreign key, an `EXPECTED_TABLES` entry, an erasure-path entry and three lines in ADR-40's per-environment guard table. _Consequence:_ the new table gives removal an explicit audit row ("this instance was removed at T"), which the synthetic answer could only express as a value diff.

**Q17. CSV export shape.** **Recommendation: long, one extra file per group, delivered as a zip when the form has any group; a form with none exports exactly the file it exports today.** Section 5.5. _Options:_ indexed wide columns, which makes the header depend on `max` rather than on the data and produces 500 mostly-empty columns for a `max: 500` group, and silently changes an automated consumer's header when a later form version raises `max`; long files, which changes the download from a file to a zip for repeat forms and asks a consumer to join on `session_id`. _Consequence:_ the export route already requires a `version` parameter for CSV because the column set depends on the version's shape; that stays true and the group files inherit it.

**Q18. How `reporting.responses.answers` represents a group.** **Recommendation: keep `questionId -> value` for everything outside a group and add one key per group id holding an ordered array of `{instance_id, questionId: value, ...}`.** _Options:_ flatten with composite keys (`grp_passengers/ins_7k2/q_passport`), which keeps the object flat and makes every consumer parse a key; the nested array, which is one more shape to document and reads the way the data is. _Consequence:_ either way, `jsonb_object_agg` must stop collapsing duplicates, which it does today with no error and no warning.

**Q19. Does the redacted outbox payload carry instance counts?** **Recommendation: no. The redacted payload carries no instance ids, no roster and no counts.** _Options:_ carry the count as operational metadata, which is genuinely useful to a consumer reconciling a delivery and is disclosive on its own ("how many dependants"); carry nothing, which keeps the CHECK's guarantee readable as "after redaction there is no respondent-derived value of any kind". _Consequence:_ recorded as a decision rather than an omission, so the next person to add a field to that payload reads the rule rather than the absence.

**Q20. Does the answer endpoint gain a batch form?** **Recommendation: yes, and the no-JS step route uses it.** _Options:_ keep one call per answer, which is fifty-four sequential round trips and fifty-four advisory locks for one nine-passenger Continue; add a batch, which is one transaction, one lock and one flow evaluation, and which also makes the answers and the roster operation atomic. _Consequence:_ the respondent-facing API carries no stability promise (ARCHITECTURE section 5.1), so this is an internal contract change and not a versioned one. It should also be weighed against **issue #968**, which is open and records that the submit sweep runs before the session lock; a batch endpoint is the natural place to fix the same class of race on the answer path.

**Q21. The `qcms_step_ctx` cookie under N instances.** **Recommendation: a repeat form's re-render takes `values` and `missingRequired` from the API's own step projection, which already returns both, and the cookie keeps only the 422 constraint errors, capped, with a documented behaviour on overflow.** _Options:_ leave it, and discover the 4 KB limit as a respondent losing every answer on a step with nine passengers and an error on each; move the whole context server side, which is state the BFF may not hold (R2). _Consequence:_ the cookie is 15 seconds and httpOnly today and stays so; what changes is how much of the re-render it is responsible for.

**Q22. How the ADR-28 cursor addresses a per-instance step page.** **Recommendation: the cursor stays a 0-based index, into the new `visibleStepViews` rather than into `visibleSteps`, and a view is `(stepId, instanceId | null)`.** _Options:_ a compound cursor on the wire (`?step=3&instance=ins_7k2`), which puts a session-scoped id in a URL a respondent can see and edit; an index into a list the server computes, which is what the cursor already is and what keeps `progress: {stepIndex, totalVisibleSteps}` meaningful. _Consequence:_ ADR-28's rule is unchanged: Continue advances one view, Back returns one, Submit appears on the last, and answering never moves the page by itself. A group of three passengers on a `perInstanceStep` presentation is three views and the progress indicator says so.

**Q23. Which ADRs are created and which are amended.** **Recommendation: two new records and nine touched.** New: **ADR-42 (core), repetition is a form-level group**; **ADR-43 (portal), repeat rendering, the no-JS roster operation and the table's semantics**. Amended or noted: ADR-01 (the compiler emits a template the renderer expands), ADR-03 (two operators), ADR-14 (the roster reaches the renderer without widening `StepResolverContext`), ADR-16 (the per-instance pass, within `semanticsVersion` 1), ADR-18 (a new `a2uiSpecVersion` and a new golden generation), ADR-28 (the cursor indexes views), ADR-31 (add and remove commit immediately; no control's row changes), ADR-33 (a retraction is per instance), ADR-40 (three more guards and one more foreign key per environment). Also **`docs/SECURITY_DESIGN.md`**: SEC-13 gains the `ins_` prefix, and the abuse section gains the instance ceilings; whether that is a new SEC number or a paragraph in an existing one is the Code Owner's call. _Consequence:_ none of those files is edited by this document; each is edited by the task that lands the behaviour it describes.

### 10.1 Draft ADR text

Drafted here, in `plan/`, so a ruling produces a record rather than a drafting exercise. Nothing below is in `docs/adr/` and nothing below is decided.

---

**ADR-42 - Repetition is a form-level group** _(would live in `docs/adr/core.md`)_

**Status:** proposed; not built. `plan/repeating-groups-and-table-input.md` is the working record and its section 10 carries the questions.

**Decision.** A form may repeat a named group of pinned questions. The group lives in a step's item list, not on a question and not on a step, and it is answered once per **instance**. An instance carries a stable, opaque, session-scoped id minted once and never reused or renumbered; the ordinal a respondent reads is its position in the live roster and is presentation only. A **looping question** is a group of one member. A **looping step** and a **table** are presentations of the same group, not separate constructs. No question type is added: the closed set stays seven and `AnswerValue` is unchanged.

An answer is keyed by `questionId` outside a group and by `instanceId/questionId` inside one, so a question outside every group keeps the key it has today. A `questionId` is still pinned at most once in a form; a question is either repeated or not.

The roster is state the server owns, held in its own append-only table with the ledger's guards, and passed to the evaluator beside the answers. A removed instance is never deleted: its answers are excluded from evaluation, from the locked submission and from reporting exactly as a hidden question's answers are (I6), and its removal is an appended row.

A group may not contain a group. A group's maximum instance count is bounded in core, and an open-ended group must declare a maximum.

**Why not a table question type.** A composite `AnswerValue` would break per-cell validation, per-cell retraction and "empty is absence" per cell, would make a partial table unstorable, and would change the grain of the ledger, the export and the reporting view, all of which are one row per question. A table as a presentation keeps every cell an ordinary answer.

**Consequences.** `SNAPSHOT_SCHEMA_VERSION` moves to 2 because the snapshot's shape changes. `SEMANTICS_VERSION` stays 1, and that is load-bearing rather than convenient: the evaluator implements one version at a time and refuses any other stamp, so a bump would make every published snapshot fail rather than preserve it. Every change is therefore additive, a form with no group evaluates byte-identically, and the committed golden scenarios pass with no `expected` block edited. `@roonga/qcms-core` and `@roonga/qcms-db` move by a minor: every schema change is additive and no canonical encoding changes.

**Note.** ADR-03 gains two operators, `anyInstance` and `instanceCount`, which is a versioned core change under that decision. ADR-16's forward-only rule is applied to a group's whole span rather than to a single position, and a rule may not read a different instance of the same group, because roster order is not document order. ADR-40's per-environment set grows by three guards and one foreign key.

---

**ADR-43 - Repeat rendering and the no-JS roster operation** _(would live in `docs/adr/portal.md`)_

**Status:** proposed; not built.

**Decision.** The compiler emits a `RepeatGroup` **template** node carrying the group's member controls once. The renderer clones it per live instance and qualifies each cloned control's `name`, so the stored compiled document is served verbatim and expansion is a render-time transform, as `withNativeSubmit` and `documentForVisible` already are (ADR-18 unaffected). The roster reaches the renderer from the API's step projection; the portal still evaluates nothing (R2).

Adding and removing an instance without scripting is a **named submit button** on the step's own form, carrying `formnovalidate` so that a half-filled step can still add an instance. The operation rides the whole-step POST that already exists, is applied after the step's answers, and returns the same 303 with a fragment naming the instance to focus. Field names are unique per instance; no repeated field name is relied on.

A table presentation renders a native `<table>` with a caption, column headers, a row header per instance and **a real label on every input**, and never `role="grid"`. A grid requires author code to manage focus, so it cannot exist with scripting disabled, and a table's documented cost is one tab stop per cell.

**Consequences.** `docs/portal-constraints.md` is updated in the same change and its exception list stays empty: there is still no question shape a respondent without scripting cannot answer. `A2UI_SPEC_VERSION` moves and a new golden generation opens. The re-render context outgrows one cookie and moves what it can to the API's own projection. The answer endpoint gains a batch form, because one call per answer does not survive a nine-instance step.

**Note.** No ADR-31 commit-moment row changes: a repeat is a layout and not a control, and the cells keep the moments their types already have. Adding and removing an instance commits immediately, because it changes state the server owns and the server is the only evaluator.

---

## 11. Acceptance cases

Numbered and testable. Each names the layer it is proved at, per ADR-23.

**Additivity**

1. All forty-four committed golden evaluator scenarios pass with no `expected` block edited, against the repetition-aware evaluator. _(unit)_
2. The insurance submission's committed `contentHash` is unchanged. _(unit)_
3. A form with no repeating group produces a `FlowState` with no new key present, asserted by deep equality against the pre-change shape. _(unit)_
4. A published snapshot stamped `schemaVersion: 1` parses, serves, accepts answers and submits unchanged. _(integration)_
5. The seven existing compiler golden documents are byte-identical in the new generation. _(unit)_

**Kernel**

6. A `questionId` pinned both inside a group and outside it is refused at parse with `DUPLICATE_QUESTION_IN_FORM`. _(unit)_
7. A group inside a group is refused at parse. _(unit)_
8. A `fromAnswer` count whose question appears after the group is refused at publish with `REPEAT_COUNT_BACKWARD_REF`; one that appears before it publishes. _(unit)_
9. A group whose `max` exceeds the core ceiling is refused at publish. _(unit)_
10. An `open` group with no `max` is refused at publish. _(unit)_
11. A rule targeting a question inside a group evaluates once per live instance, and a condition reading a question in the same group resolves to that instance's answer and to no other. _(unit, golden)_
12. `anyInstance` is true when one of three instances matches and false when none does; `instanceCount gte 5` is false at four instances and true at five. _(unit, golden)_
13. A rule reading a question inside a group and targeting a question outside it is refused at publish unless its target follows the group's whole span. _(unit)_
14. A removed instance's answers are excluded from every later condition, from `missingRequired`, and from the locked submission, while remaining in the ledger. _(unit, golden, integration)_
15. Lowering a `fromAnswer` count hides the trailing instance; raising it again restores the same instance id with its answers intact. _(integration)_
16. A required question inside a group with three live instances and two answered produces exactly one `MISSING_REQUIRED` entry naming the third instance. _(unit)_
17. A group below `min` or above `max` at submit is refused with `REPEAT_COUNT_OUT_OF_RANGE`. _(unit)_
18. A cell posted as `""` or `[]` is refused with `EMPTY_ANSWER_NOT_ALLOWED`, per cell, and `null` retracts that cell alone. _(integration)_

**Storage**

19. Two answers for one question in two instances both persist and both read back; `latestAnswers` returns one value per `(question, instance)`. _(integration, real Postgres)_
20. An UPDATE and a DELETE on `answers` and on `answer_group_instances` are both rejected by trigger, outside the erasure door. _(integration, real Postgres)_
21. `eraseSession` leaves no row in `answers`, `submissions` or `answer_group_instances` for that session, asserted by count, and writes one tombstone. _(integration, real Postgres)_
22. `purgeExpired` reaches the roster table. _(integration, real Postgres)_
23. `migrations.test.ts`'s `EXPECTED_TABLES` names the new table, and the drizzle chain and its snapshots link. _(unit)_

**Serving, both paths**

24. With scripting on: answering three passengers, adding a fourth, removing the second, and submitting produces a locked set of three instances with the right answers against the right ids. _(browser)_
25. With `javaScriptEnabled: false`: the same walk completes, including add and remove, and reaches the receipt. _(browser)_
26. With scripting off, pressing **Add passenger** on a step with a blank required field adds the instance rather than being refused by the browser, and the step comes back with the API's own missing-required report. _(browser)_
27. With scripting off, only the pressed button's name and value reach the server: a POST carries exactly one `__qop` entry, or none. _(unit on the decoder, browser on the wire)_
28. An error summary entry reads "Passenger 2: passport number is required" and its anchor moves focus to that instance's passport field. _(browser)_
29. After adding an instance with scripting on, focus is on the new instance's heading; after removing one, focus is on the heading of the instance that took its place, and on the Add button when the removed one was last. _(browser)_
30. Adding an instance with scripting on announces through a `role="status"` region as a whole sentence. _(browser)_
31. A ten-instance step carries exactly one honeypot decoy. _(unit on the compiled document, browser on the DOM)_
32. A nine-instance step's re-render after a validation failure returns every answer the API accepted, with no cookie overflow. _(browser)_
33. The whole-step POST for a nine-instance step makes one batched API call, not fifty-four. _(integration)_

**Table presentation**

34. The table renders as a native `<table>` with a caption, `<th scope="col">` per column and `<th scope="row">` per row, and no `role="grid"` anywhere. _(unit, jsdom)_
35. Every cell input has an accessible name naming its row and its column, asserted from the accessibility tree and not from the DOM. _(unit, jsdom)_
36. At 390px the table reflows to one card per row, every input keeps the same accessible name, and the page has no horizontal scroll. _(browser, mobile project)_
37. A column type outside the allowed set is refused at publish with `TABLE_COLUMN_TYPE_NOT_ALLOWED`. _(unit)_
38. The column total is not an input, is not posted and appears in no locked answer set. _(browser, integration)_
39. A focused cell in the first row is not obscured by a pinned header. _(browser)_
40. axe reports no violation on a filled table at every viewport project. _(browser)_

**Downstream**

41. A CSV export of a form with one group produces the unchanged wide file plus one group file, joinable on `session_id`, with the formula-injection guard applied in both. _(integration)_
42. A CSV export of a form with no group is byte-identical to today's. _(golden)_
43. `reporting.answers_flat` returns one row per `(session, question, instance)` and loses nothing; the pre-change query against a non-repeating form returns identical rows. _(integration, real Postgres)_
44. `reporting.responses.answers` for a non-repeating form is byte-identical to today's. _(integration, real Postgres)_
45. The `response.submitted` payload carries every instance inside its `answers` member and nowhere else, asserted by walking the payload for respondent content outside that key. _(integration)_
46. After redaction, the payload holds no `answers` key, no instance id and no count, and the CHECK holds. _(integration, real Postgres)_
47. No exported span or log record carries an answer value or an instance label; `ins_` ids are permitted. _(integration, the existing in-test OTLP receiver)_

**Abuse**

48. An add that would exceed the group's `max` is refused by the API, and so is one that would exceed the session's total instance ceiling. _(integration)_
49. A step POST above the field-count or body-size limit is refused with the standard error envelope. _(integration)_
50. The roster operation is rate limited per session and per IP. _(integration)_

**Authoring**

51. An author can define a group, choose each count source, set `min` and `max`, write the label template and switch presentation, and the draft round-trips through save and reload. _(browser, admin project)_
52. The rules editor shows "evaluated per passenger" on a rule whose target is inside a group, and offers structured editors for both new operators. _(browser)_
53. The test bench evaluates a rule against hypothetical instances and reports a per-instance result. _(browser)_
54. The preview expands a group through the same renderer the portal uses, and its DOM for a repeated step matches the portal's structurally. _(browser)_
55. The library picker offers only the allowed cell types when adding a column to a table-presented group, and says why. _(browser)_

---

## 12. Task breakdown

**Numbers 071 to 077.** 070 is the highest allocated number; C1 to C3 deliberately hold no numbers so that 071 onward stay in circulation. Stage 9, Phase 4. None of this gates launch and none is dispatched before task 038.

**Gates per task.** Every task runs `pnpm verify`. A task touching `apps/portal`, `apps/admin` or `@roonga/qcms-ui` also runs `QCMS_PORT_SEAT=<0-9> pnpm verify:browser`, detached. A task touching Docker-backed suites also runs the forced run (`pnpm exec turbo run test --force`, confirming it executed rather than cached), and a task changing the boot environment runs `QCMS_PORT_SEAT=<0-9> pnpm up:e2e`. From task 064 onward those suites run once per environment, so if this track lands after the environments track its gate time is doubled with it.

**One dependency outside this plan.** **Issue #968** (the submit sweep runs before the session lock) should close before 073, because repetition multiplies the window it describes by the number of fields a step posts and the no-JS path posts a whole step at once.

### Track A - the model and the ledger

**071 - The repeating group in the kernel.** Depends on 038. Q2, Q4, Q5, Q6, Q7, Q8, Q12, Q13, Q14 and Q15 all bear on it.

_Deliverables._ `GroupId` and `InstanceId` branded ids. `RepeatGroup`, `RepeatCount` and the widened `Step.items`. The widened `AnswerMap` key and the optional `rosters` parameter on `evaluateRules`. The per-instance forward pass and the two new operators, with `conditionDepth` reaching into `anyInstance`. `documentOrder` expanding a group into a span, and `analyzeRuleGraph` applying the forward-only rule to a span. `checkRuleTypes` gaining branches for both operators. The new publish codes of section 3.1 and the new submission code of section 3.3. The optional `FlowState` fields of section 3.5. `SNAPSHOT_SCHEMA_VERSION` to 2. The instance ceilings as core constants. Appended golden evaluator scenarios and corpus-local forms. **And the admin's parallel operator list in `apps/admin/lib/forms/condition.ts`, in this PR**, because the type-only import means the admin does not typecheck without it; nothing else in the admin moves here.

_Exit criteria._ Acceptance cases 1, 2, 3, 6 to 18, and the hand-spelled operator list in `visibility-rule.test.ts` naming fifteen operators deliberately. Plus: no `expected` block in `packages/core/golden/evaluator/` is modified, asserted by `check:golden-append-only` rather than by review; and `SEMANTICS_VERSION` is still 1, asserted by the constant and by case 1 passing.

_Gates._ `pnpm verify`.

**072 - The instance ledger.** Depends on 071.

_Deliverables._ `answers.instance_id`, the widened `DISTINCT ON` in `latestAnswers` and the widened index. The `answer_group_instances` table with its two triggers, its CHECK, its index and its foreign key, in an appended migration. The roster read and the add and remove writes as query helpers. `eraseSession` and `purgeExpired` reaching the new table behind the existing door. The hand-kept `AnswerRow` type and its `_AnswerRowMatchesTable` guard (issue #5). `EXPECTED_TABLES` (issue #861). **And the proposed Note on ADR-40**: the per-environment guard set becomes fifteen and the foreign keys eight, with the two new trigger functions single in `control`, so task 064's generator emits them.

_Exit criteria._ Acceptance cases 19 to 23. Plus: an erasure leaves no row in any of the three tables, asserted by count against a real Postgres rather than by reading the code, because the erasure table list is hand-kept and a missing entry is silent.

_Gates._ `pnpm verify`, forced Docker-backed run.

### Track B - serving

**073 - Repeat rendering, the roster operation, and both paths.** Depends on 071, 072 and the closure of issue #968. Q9, Q11, Q15, Q20, Q21.

_Deliverables._ The compiler's `RepeatGroup` template node, `A2UI_SPEC_VERSION` and `COMPILER_VERSION` moves, and the new golden generation carrying the seven existing forms unchanged plus repeat forms. `docs/a2ui-mapping.md` gaining the node. The renderer's render-time expansion and name qualification, keyed per instance (issue #144's rule, one control instance per field). `documentForVisible` and `commitMoments` reaching qualified names. The API's step projection carrying the roster. The batch answer endpoint (Q20) and the roster-operation endpoint. The portal's `__qop` decoding, the `formnovalidate` buttons, the fragment-based focus landing, the `role="status"` region, the instance-naming error summary, and the re-render context change (Q21). The stacked presentation. All three count sources. `docs/portal-constraints.md` updated in the same change. **And the template mirror** under `packages/create-qcms-app/templates/common/`, which `check:templates` enforces.

_Exit criteria._ Acceptance cases 5, 24 to 33, and 47. Plus: the no-JS claim's seven named specs still pass, and an eighth joins them for the repeat walk; `docs/portal-constraints.md`'s exception list is still empty.

_Gates._ `pnpm verify`, `pnpm verify:browser` detached, forced Docker-backed run, `pnpm up:e2e`.

**074 - Authoring a repeating group.** Depends on 071 and 073. Q4, Q6, Q12.

_Deliverables._ The widened `DraftStep.items` and the pure group mutations in `lib/forms/draft.ts`. The group panel of section 6.2. Group boundaries in `step-editor.tsx` and `lib/forms/pin-grid.ts`, and a group node in the rail tree. The rules editor's scope chip, the two structured operator editors, `rule-sentence.ts`, `eligibleTargets` over a span. The test bench's instance dimension and the draft-preview endpoint change behind it. `draft-preview.tsx` expanding a group with a locally minted roster.

_Exit criteria._ Acceptance cases 51 to 54.

_Gates._ `pnpm verify`, `pnpm verify:browser` detached.

### Track C - downstream and the remaining presentations

**075 - Export, reporting and the webhook payload.** Depends on 071, 072 and 073. Q17, Q18, Q19.

_Deliverables._ The CSV group files and the zip, with the wide file unchanged. The reporting view generator: `answers_flat.instance_id`, the group key in `responses.answers`, and the `jsonb_object_agg` fix. `docs/reporting-view.md` and its drift test in the same change, with the `@roonga/qcms-db` minor. `LockedAnswer.instanceId` reaching the outbox payload inside `answers` and nowhere else. `docs/webhooks.md` gaining an example. SEC-13's allowlists gaining `ins_`.

_Exit criteria._ Acceptance cases 41 to 47. Plus: a walk of the payload asserting no respondent content outside the `answers` key, because the redaction and its CHECK both depend on that and nothing else states it.

_Gates._ `pnpm verify`, forced Docker-backed run.

**076 - The per-instance step presentation.** Depends on 073. Q22.

_Deliverables._ `visibleStepViews` populated, the cursor indexing views, `progress` counting them, Back and Continue moving one view, Submit on the last. The admin's presentation switch reaching it and the preview walking it.

_Exit criteria._ A three-instance group presents as three views, the progress indicator says three, Back and Continue traverse them in roster order, and ADR-28's rule that answering never moves the page by itself holds. Both paths.

_Gates._ `pnpm verify`, `pnpm verify:browser` detached.

**077 - The table presentation.** Depends on 073. Q10, Q12.

_Deliverables._ The table layout in `@roonga/qcms-ui`, built on the vendored `Table`'s markup and style map (it is not in the renderer registry today and is a read-only display table). The per-cell label, the row header, the caption, the `<tfoot>` total as presentation. The 390px card reflow and the `overflow-x: auto` box above it. The publish refusal of a disallowed column type. The admin's column view of the member list and the filtered picker. The `docs/COMPONENT_GUIDELINES.md` checklist items that bind a layout: the no-JS path, the focus targets, the theming rules in `theme-components.css` beneath the ADR-38 scope carrier, the font sweep, the tabular-figures selector for the numeric column, and lint coverage.

_Exit criteria._ Acceptance cases 34 to 40, 55.

_Gates._ `pnpm verify`, `pnpm verify:browser` detached.

### The minimum shippable slice

**071, 072, 073 and 074.** That is: a repeating group with all three count sources, the stacked presentation, per-instance rules including both new operators, the instance ledger, both respondent paths with add and remove, and an admin that can author one.

It is the minimum because each of the four is load-bearing and none of the three that follow is. Without 071 there is no model. Without 072 the roster has nowhere to live and an instance the respondent added is lost on reload. Without 073 nobody can answer one, and 073 is where the two hardest problems live, the no-JS roster operation and the render-time expansion. Without 074 nobody can author one, and 074 cannot be deferred in any case because the admin does not typecheck once 071 adds an operator, so part of it is forced into 071 already.

**075 is the first thing after**, and it should land before any real deployment uses a repeating group: until it does, a repeated answer is silently collapsed by `jsonb_object_agg` in the reporting view and dropped by the CSV export's one-column-per-question premise. That is a data-loss window, not a missing feature, and the plan would rather name it here than have it discovered.

**076 and 077 are presentations of a proven model** and are demand-ordered against each other. If only one ships, 077 is the one the financial use case asks for by name and 076 is the one a phone benefits from most.

---

## 13. Sources

Checked live on 2026-09-29. Quotations in sections 4 and 10 come from these pages.

**W3C ARIA Authoring Practices Guide**

- Table pattern, https://www.w3.org/WAI/ARIA/apg/patterns/table/ : a table "is not an interactive widget"; "authors are strongly encouraged to use a native HTML `table` element whenever possible"; "Since a table is not a widget, each widget contained in a table is a separate stop in the page tab sequence."
- Grid pattern, https://www.w3.org/WAI/ARIA/apg/patterns/grid/ : a grid "Requires the author to provide code that manages focus movement inside it"; only one of its focusable elements is in the page tab sequence; the two optimal cell designs, which cover link, button, menubutton, toggle button, radio button, switch and checkbox, or text and a single graphic, and not an editable text field; the Enter, F2, Escape edit-mode model for editable cells.
- Data grid examples, https://www.w3.org/WAI/ARIA/apg/patterns/grid/examples/data-grids/
- Names and descriptions, https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/ : prefer visible text; prefer native techniques, "the HTML `label` element for form elements"; "Put the most distinguishing and important words first."
- Keyboard interface, https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/ : after "a destructive operation like deleting an item from a list", set focus "on the list item following the deleted item".

**WCAG 2.2**

- The recommendation, https://www.w3.org/TR/WCAG22/
- 1.3.1 Info and Relationships, https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html
- 2.4.3 Focus Order, https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html
- 2.4.6 Headings and Labels, https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html
- 2.4.11 Focus Not Obscured (Minimum), new at 2.2, https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html : names "sticky footers, sticky headers".
- 2.5.7 Dragging Movements, new at 2.2, https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html : bears only if reordering is offered.
- 2.5.8 Target Size (Minimum), new at 2.2, https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- 3.2.2 On Input, https://www.w3.org/WAI/WCAG22/Understanding/on-input.html : "clicking on a link is activating it, rather than changing its setting."
- 3.2.6 Consistent Help, new at 2.2, https://www.w3.org/WAI/WCAG22/Understanding/consistent-help.html : "distinct from ... instructional text in a form", so it binds the chrome and not the group.
- 3.3.1 Error Identification, https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html
- 3.3.2 Labels or Instructions, https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html
- 3.3.3 Error Suggestion, https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html
- 3.3.7 Redundant Entry, new at 2.2, https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html : information "required to be entered again in the same process".
- 3.3.8 Accessible Authentication (Minimum), new at 2.2, https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html : authentication only, so it does not bear.
- 4.1.3 Status Messages, https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html : "messages that involve changes of context do not need to be considered and are not within the scope of this success criterion"; the "3 items" warning about announcing only a changed number.
- Techniques H43, H44, H63, H71 and ARIA22, at https://www.w3.org/WAI/WCAG22/Techniques/html/H43 , /H44 , /H63 , /H71 and https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA22 . H44 carries the sentence the plan leans on twice: a hidden `label` is sufficient for 1.3.1 and 4.1.2, "However, for Success Criterion 3.3.2 (Labels or Instructions), the label element must be visible".

**W3C WAI tutorials**

- Tables, https://www.w3.org/WAI/tutorials/tables/ , with https://www.w3.org/WAI/tutorials/tables/two-headers/ , /irregular/ , /multi-level/ and /tips/ . The tips page carries the responsive rule: "On small screens ... responsive tables often change format. Ensure that the structural relationship is available in all formats."
- Forms: labels, https://www.w3.org/WAI/tutorials/forms/labels/ ; grouping, https://www.w3.org/WAI/tutorials/forms/grouping/ , whose two same-shaped address blocks are the published analogue of a repeated instance, and which carries the warning that some screen readers read the legend with every control.

**HTML Living Standard and MDN**

- Constructing the form data set, https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#constructing-the-form-data-set : controls are taken "in tree order"; an unchecked checkbox or radio contributes nothing; "field is a button but it is not submitter" is skipped.
- Converting an entry list to name-value pairs, https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#converting-an-entry-list-to-a-list-of-name-value-pairs
- The `button` element, https://html.spec.whatwg.org/multipage/form-elements.html#the-button-element : "A button (and its value) is only included in the form submission if the button itself was used to initiate the form submission."
- Form submission attributes, https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#form-submission-attributes and #attr-fs-formaction : `formaction`, `formmethod` and `formnovalidate` are submit-button attributes, and "The formnovalidate attribute can be used to make submit buttons that do not trigger the constraint validation."
- `fieldset` and `legend`, https://html.spec.whatwg.org/multipage/form-elements.html#the-fieldset-element and #the-legend-element
- `th` `scope` and `td`/`th` `headers`, https://html.spec.whatwg.org/multipage/tables.html#attr-th-scope and #attr-tdth-headers
- MDN `<button>`, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/button ; MDN `FormData.getAll()`, https://developer.mozilla.org/en-US/docs/Web/API/FormData/getAll

**Where the sources are silent, recorded rather than filled**

1. No W3C source found covers **naming a form control inside a data cell**. The tables tutorial, the forms tutorial and the APG are all silent on it. H44 and the APG naming practice are the nearest authorities and are what section 4.4 leans on.
2. `scope` and `headers` associate a **cell** with header cells. No source claims they contribute to a **control's** accessible name.
3. No source states that a visible `<th>` discharges **3.3.2** for the input beneath it. Section 4.4 says so as an inference and names task 030's manual pass as where it is tested.
4. WCAG says nothing about **focus after a deletion**; the APG sentence quoted above is the only authority, it addresses a scripted DOM removal, and nothing found addresses a full-page POST-redirect-GET. The no-JS landing is a decision this plan takes.
5. The APG gives **no no-JS story for `role="grid"`** at all, which is not a disagreement with the recommendation so much as the reason for it.
6. The HTML standard guarantees duplicate-name submission order **per name** and offers no indexing mechanism, so indexed names are an application convention whichever way they are spelled.
