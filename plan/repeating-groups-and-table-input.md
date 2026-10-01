# Repeating groups and table input

**Status:** **ruled 2026-09-29 by the Code Owner; decided, not built.** This is the design document written at the Code Owner's request against `origin/main` at `c1988256`. It states **one** new kernel concept, the **repeating group**, and argues that all three of the capabilities asked for (a looping question, a looping page or step, and a table input) are presentations of it rather than three mechanisms. Section 10 carried **twenty-three numbered questions**; every one of them is now answered, and each carries its ruling beside the recommendation it was put with. Five rulings differ from the recommendation (Q1, Q4 by consequence of Q14, Q7, Q14 and Q17) and this document is rewritten to the rulings rather than annotated over the recommendations; each rewritten section keeps a one-line note of what was recommended, so a later reader can see what was weighed.

The records the rulings produce are **not drafted here any more**: ADR-42 lives in `docs/adr/core.md`, ADR-43 in `docs/adr/portal.md`, SEC-16 in `docs/SECURITY_DESIGN.md`, the nine amendments in the ADRs they amend, and the ledger rows in `docs/features/README.md`. This document is the working record behind them.

**This is launch scope (Q1, ruled 2026-09-29).** It was written as Phase 4 work and recommended as such; the Code Owner ruled it into launch instead, which **moves the cut-line** rather than sitting inside it. `docs/PROJECT_GOAL.md` section 5 now enumerates repeating groups among what launch includes, `docs/IMPLEMENTATION_PLAN.md` carries the work as stage 8c, and tasks 071 to 077 are sequenced for launch rather than after task 038. It is deliberately **not** recorded in `docs/features/039-phase4-backlog.md`, which is the Phase 4 itch ledger and is the wrong home for launch scope.

**Concept pages (published separately).** Three HTML concept pages accompany this document: `portal-passengers.html`, the respondent view of the airline passenger loop; `portal-table-input.html`, the respondent view of the assets table beside the same data as stacked cards; and `admin-authoring.html`, the admin group settings, the column editor and the rules editor with instances. They are **concepts to react to, not approved designs**, and they are deliberately **not committed to the repository**, so that nothing mistakes them for `plan/admin-shell-poc/*.html`, which are the approved-design POCs. Each page opens with a caption naming the questions in section 10 it illustrates and the recommendation it shows. **One of them is superseded in part:** the passenger concept lays two fields side by side inside an instance card, and the Q12 ruling makes the stacked presentation one input per row at every width, so read that page's layout as drawn before the ruling and section 4.4 as what ships.

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

## 2. Model options, and the model that was ruled

### 2.1 The model in one paragraph

_Ruled 2026-09-29 (Code Owner), as recommended (Q2, Q3)._

Add exactly one concept to the kernel: a **repeating group**, a named, ordered set of pinned question refs that lives inside a `Step`'s item list and is answered once per **instance**. An instance carries a stable, opaque, session-scoped id that is minted once and never reused or renumbered; the ordinal a respondent reads ("Passenger 2") is its position in the live roster and is presentation only. A **looping question** is a repeating group with one member. A **looping step** is a repeating group whose presentation paginates its span into one step view per instance. A **table** is a repeating group whose presentation lays instances out as rows and members as columns. One model, one answer-addressing scheme, one storage grain, one rules reach, one export shape, three presentations.

Two properties of that sentence are rulings in their own right and are easy to lose. **The group declares its own maximum, and no installation-wide ceiling stands above it** (Q4 as amended by Q14): `max` is required on every count source that is not `fixed`, so the payload, the tab-stop count, the POST size and the evaluator's per-instance walk are bounded per form and nowhere else. The one exception is a **cost** bound rather than a size one: a rule inside one group that reads another group with a whole-group operator costs the product of their maxima, and publish refuses that single rule shape above a fixed evaluator budget (section 3.4). It caps no group's size. And **the rules reach is three operators, not two** (Q7): `anyInstance`, `instanceCount` and `everyInstance`, the last of which is **false over an empty group** by decision.

### 2.2 Option set for the container

| Option                               | What it is                                                                              | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Repeat on a single question**   | A `repeat: {min, max}` field on `QuestionDefinition`, making a question's answer a list | **Rejected.** It changes `AnswerValue` (a new non-scalar member of a union whose own doc says it is untagged by design), it changes what `validateAnswer` returns, and it cannot express the airline case at all, because six questions have to repeat together. It also makes repetition a property of a **question**, which breaks reuse: the same question could not then be single in one form and repeated in another without a new `questionId` (R6). |
| **B. Repeating group inside a step** | A container in `Step.items` holding question refs plus a count rule                     | **Recommended.** Additive to `FormDefinition`, leaves `QuestionDefinition` and `AnswerValue` untouched, and expresses all three capabilities.                                                                                                                                                                                                                                                                                                               |
| **C. Repeating step**                | A `repeat` field on `Step`, making the whole step iterate                               | **Rejected as the primitive, kept as a presentation.** As a primitive it forces a group to occupy a whole step, which the financial case does not want (an income-source loop sits beside other questions), and it puts the iteration on the object that also carries navigation, so the ADR-28 cursor and the loop would be one concept. As a **presentation** of B it is exactly the looping-page capability, with no second model.                       |
| **D. A sub-form reference**          | A form embedded in a form, repeated                                                     | **Rejected.** It multiplies publish, pinning and version resolution by a second axis for no capability B does not have, and a sub-form would need its own rules scope, its own snapshot and its own compiled documents.                                                                                                                                                                                                                                     |

### 2.3 Option set for the table

| Option                                      | What it is                                                                                        | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1. A distinct `table` question type**    | An eighth member of the `QuestionDefinition` union, whose answer is a matrix in one `AnswerValue` | **Rejected, and this is the load-bearing call of the document.** It costs a new `AnswerValue` member, which is the first structured value in a union whose doc says the wire form is the raw JSON value. It breaks "empty is absence" per cell, because `isBlankAnswerValue` is deliberately type-blind and has no reading of "all cells empty". It makes the whole table one ledger row, so a per-cell retraction (ADR-33) is inexpressible, per-cell validation cannot report `{code, constraint, message}` against a cell, and a partial table cannot be stored. It breaks the CSV and reporting grain, which is one row per question. And it grows **every exhaustive switch and every `Record<QuestionType, ...>` table over the question type** across core, the compiler and the admin's parallel list; the renderer is not among them, because it switches on node type rather than on question type. |
| **T2. A presentation of a repeating group** | `presentation: "table"` on the group; rows are instances, columns are member questions            | **Recommended.** Every cell is an ordinary question with an ordinary `AnswerValue`, so per-cell validation, per-cell retraction, "empty is absence" per cell, the rules DSL, the ledger grain, the export grain and the reporting view all work unchanged. The table is then a **layout**, and `@roonga/qcms-ui` gains a layout component rather than an input control.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

T2's cost, named honestly: an author who thinks "table question" has to learn that a table is a group with columns, and the column set is constrained to the five cell types Q12 settles. That is a vocabulary cost in the admin, which section 6 spends on labelling rather than on a second model.

**What T2 buys that is easy to miss.** `docs/COMPONENT_GUIDELINES.md` opens by splitting work into ADR-sized ("a new question type, the kernel's closed set grows") and checklist-sized ("a new rendering for an existing type"). Under T2 **no question type is added**: the kernel's closed set of seven is unchanged, `AnswerValue` is unchanged, and no new adapter translates a raw control value to a canonical `AnswerValue`. The kernel change (the container) is ADR-sized because `FormDefinition` and the rules DSL grow; the rendering change is checklist-sized, and the parts of the thirteen-item checklist that bind are the ones about behaviour rather than registration: the no-JS path, the focus targets, the theming tokens, the lint coverage and the controlled-adapter contract. Items 1 to 3 (vendoring, registry entry, the ADR-31 commit moment) do not bind a layout container, and item 4's clear path binds the cells, which already have one.

### 2.4 Count source

_Ruled 2026-09-29 (Code Owner): all three sources ship, and the Q14 ruling amends the second half of this section. The plan recommended `max` required on `open` alone; the ruling makes it **required on `fromAnswer` too**, because with no installation-wide ceiling the group's own `max` is the only bound that exists._

Three sources, all wanted, one schema:

```ts
const RepeatCount = z.discriminatedUnion("source", [
  z.object({ source: z.literal("fixed"), count: z.number().int().min(1) }),
  z.object({
    source: z.literal("fromAnswer"),
    questionId: QuestionId,
    min: z.number().int().min(0),
    max: z.number().int().min(1), // required
  }),
  z.object({
    source: z.literal("open"),
    min: z.number().int().min(0),
    max: z.number().int().min(1), // required
  }),
]);
```

- **`fixed`** is the degenerate case and is what a looping question with a known count uses. **A fixed count is its own bound**, so it carries no `max`: the number is the maximum.
- **`fromAnswer`** points at a `number` question that must appear **strictly before** the group in document order, which is the same rule `analyzeRuleGraph` already enforces for rule references (ADR-16, I10) and is refused at publish with a new code rather than a new mechanism. **`max` is required.** The count question is answered by the respondent, so without a `max` the respondent chooses the size of the loop, which is the same unbounded write path an open-ended group with no maximum is.
- **`open`** is add and remove, and `max` is **required** on it. An open-ended group with no maximum is an unbounded write path into an append-only ledger, which section 8 treats as an abuse control and not as an authoring convenience.

Publish refuses a missing `max` on either bounded source with `REPEAT_MAX_MISSING`. `min` and `max` apply as validation bounds; for `fixed` they are derived from the count and for `fromAnswer` they bound what the count question may produce, so a count answer of 400 against `max: 9` is refused at the count question rather than discovered at the loop.

### 2.5 Nesting

_Ruled 2026-09-29 (Code Owner), as recommended (Q13)._

**A hard depth of one: a repeating group may not contain a repeating group.** The kernel refuses it at parse. The reasons are cost and comprehensibility in that order: a nested group makes an instance address a path rather than a pair, makes the evaluator's per-instance walk quadratic in instances, makes the no-JS field name a path, makes the CSV grain a tree, and makes an error summary say "Passenger 2, Bag 3: weight is required" before anyone has read whether that sentence is usable. Nothing in either sample use case needs it. Q13 records what lifting the cap later would cost.

### 2.6 Per-instance labels

_Ruled 2026-09-29 (Code Owner), as recommended (Q6)._

The group carries `instanceLabel: LocalizedText` with a single `{n}` placeholder, "Passenger {n}". `{n}` is the **live ordinal**, one-based, recomputed after a removal, so removing passenger 2 of three leaves headings "Passenger 1" and "Passenger 2" and not "Passenger 1" and "Passenger 3". **The stable instance id is never shown as a label.** It is not hidden, and the earlier phrasing ("never appears to a respondent") was wrong: an `ins_` id appears in every field `name`, in every DOM `id`, in each error-summary anchor, in the Remove button's `value`, and in the fragment the no-JS re-render focuses, all of which a respondent can read in the page source. What it never is is **text a respondent reads as the name of anything**: no heading, legend, label, error message or button caption carries it. It is an opaque correlator in the markup, not an identifier the respondent is asked to understand. Publish validates that the template is present for the default locale and, per ADR-11 and the `LOCALE_INCOMPLETE` check, for every locale the form declares; a template with no `{n}` is allowed (a group of one), a template with an unknown placeholder is refused.

**Why the ordinal is presentation and the id is identity.** If the respondent's ordinal were the key, removing passenger 2 would re-target passenger 3's passport answer at passenger 2's row, silently, in the ledger and in every export already taken. That is the R6 failure mode one level down: an id that is reused with a different meaning. The roster is what makes the ordinal derivable and the id permanent.

---

## 3. Kernel impact

Everything in this section is **additive**, and that is a requirement rather than an aesthetic. `packages/core/golden/evaluator/CORPUS.md` and ADR-16's own amendment both record that a `SEMANTICS_VERSION` bump **cannot currently be taken**: the evaluator implements exactly one version at a time and refuses any other stamp, so bumping to `2` would not preserve old snapshots' behaviour, it would make every published snapshot fail at serve, answer and submit alike. Multi-version evaluation is the missing prerequisite and is not in scope here. The design rule that follows is absolute:

> **A form with no repeating group must parse, compile, evaluate, validate, submit, export and report byte-identically to today, including the exact shape of `FlowState`.** **Every** committed golden evaluator scenario passes unchanged, with no `expected` block edited. The criterion is deliberately "every" rather than a number: `packages/core/golden/evaluator/scenarios/` held **51** scenario files at `c1988256`, the commit this document was written against, and a criterion stated as a count is satisfiable by a corpus that has lost files.

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

The union is discriminable without a tag because the two shapes have disjoint required keys (`questionId` against `groupId`), so every form definition that exists today parses unchanged. No explicit `kind` discriminator is carried, because adding one would be the one change in this section that is not additive.

**`DUPLICATE_QUESTION_IN_FORM` stays exactly as it is**, and is extended to reach inside groups: a `questionId` is pinned at most once in a form whether it sits in a step or in a group. A question is therefore either repeated or not, in a given form, and the refinement's stated reason (unambiguous answer keying) holds under the new key as it did under the old.

New publish-time codes, all in the existing `PublishError` union and all reported alongside the others rather than short-circuiting: `DUPLICATE_GROUP_ID`, `REPEAT_COUNT_BACKWARD_REF` (a `fromAnswer` source whose question does not precede the group), `REPEAT_COUNT_NOT_A_NUMBER` (it is not a `number` question), `REPEAT_NESTING_NOT_ALLOWED`, `REPEAT_MAX_MISSING` (a `fromAnswer` or `open` source with no `max`, Q4 as amended by Q14), `REPEAT_MIN_ABOVE_MAX`, `INSTANCE_LABEL_PLACEHOLDER_UNKNOWN`, `RULE_TARGETS_SPAN_SCOPES` (one rule's `show` list straddling a group boundary, section 3.4), `REPEAT_EVALUATION_BUDGET_EXCEEDED` (a cross-group whole-group operator whose `max_H x max_G` exceeds the evaluator budget, section 3.4), and for the table presentation `TABLE_COLUMN_TYPE_NOT_ALLOWED`.

**Four more came out of building it** (Q24 to Q26, ruled 2026-09-29), and every one of them closes a shape that published cleanly and could never fire, which is the worst kind of authoring defect because nothing anywhere says so: **`DANGLING_GROUP_REF`** (a whole-group operator naming a group the form does not declare), **`REPEAT_OPERATOR_NESTING_NOT_ALLOWED`** (a whole-group operator inside another's condition, section 3.4), **`RULE_READS_GROUP_WITHOUT_OPERATOR`** (a bare reference to an in-group question from a rule that is not evaluated inside that group) and **`REPEAT_COUNT_INSIDE_GROUP`** (a `fromAnswer` count question that itself sits inside a group). A `fromAnswer` count question the form does not pin is reported with the existing **`DANGLING_QUESTION_REF`**, whose path shape already fits. **There is no `REPEAT_MAX_ABOVE_CEILING`**: the Q14 ruling removed the installation-wide ceiling this document recommended, so publish checks that a `max` is declared and coherent with `min`, and never that it is small enough.

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

_Ruled 2026-09-29 (Code Owner): **three** new operators, not the two this document recommended. `everyInstance` ships, and its reading over an empty group is defined as **false**._

Two things happen, and only one of them grows the closed operator set.

**Scope is implicit, by position.** A rule whose `show` target is a question inside group G is evaluated **once per live instance of G**. Inside that evaluation, a reference to a question that is also inside G resolves to **that instance's** answer; a reference to a question outside G resolves normally. No syntax changes for this case, so the airline's "this passenger is an infant, show this passenger's fare basis" rule is written exactly as an ordinary rule is written today. The admin states the scope on the rule rather than making the author encode it (section 6).

**One rule, one scope, enforced at publish** (ruled 2026-09-29, Code Owner). `VisibilityRule.show` is an **array**, so the sentence above is ambiguous for a rule that lists one target inside G and another outside it, or inside a different group H: under "a rule whose target is inside G" such a rule is both per-instance and whole-form, and there is no reading that makes it one thing. It is not resolved by evaluating per target, which would make one rule mean two things at once and make the admin's scope chip a lie. **Every `show` target of one rule must share one scope**: all of them inside the same group, or all of them outside every group. A mixed list is refused at publish with **`RULE_TARGETS_SPAN_SCOPES`**, naming the rule and the two scopes it straddles, and **the admin says to split it into two rules**, which is always possible because the condition is copyable and the split changes nothing about what either rule means.

**Three new operators**, for the outside-in direction, which has no implicit reading:

```ts
| { op: "anyInstance";   groupId: GroupId; condition: Condition }
| { op: "everyInstance"; groupId: GroupId; condition: Condition }
| { op: "instanceCount"; groupId: GroupId; compare: "equals" | "gt" | "gte" | "lt" | "lte"; value: number }
```

`anyInstance` is true when its nested condition holds for at least one live instance, with references inside that condition resolving per instance. `instanceCount` compares the live instance count, reusing the **names** of the existing comparison operators as a field rather than introducing a second comparison vocabulary.

**`everyInstance` over an empty group is FALSE, and that is a decision rather than an implementation detail.** The recommendation in this document was to cut the operator precisely because its vacuous reading is a trap: read as classical universal quantification, "every passenger holds a passport" is true of a group with no passengers, which is the opposite of what an author writing that sentence means. The Code Owner ruled the operator in and ruled the trap out at the same time, by defining the empty case as false. Four consequences follow and every one of them has to be written down in the place that would otherwise assume the classical reading:

1. **It is not `not(anyInstance(not c))`.** Over an empty group that expression is true and `everyInstance` is false, so the two are equivalent only when at least one instance is live. Nothing in the evaluator, the admin or a golden scenario may treat one as a rewrite of the other.
2. **The evaluator states it as a base case**, not as a fold: an empty roster short-circuits to false before the per-instance walk begins. `everyInstance` over a non-empty roster is the ordinary conjunction over live instances.
3. **The rule sentence says so.** `lib/forms/rule-sentence.ts` renders it as "every passenger ... (and there is at least one passenger)", because the sentence an author reads is where the non-vacuous reading has to be visible; a sentence reading only "every passenger holds a passport" would invite the classical reading back.
4. **The golden corpus carries the empty case explicitly**, beside the ordinary all-match and one-mismatch cases, and the admin test bench lets an author evaluate a rule against zero instances so the reading is discoverable rather than documented.
5. **The mirror trap is closed too, and it is the one the ruling opens.** Closing the vacuous reading for `everyInstance` makes its **negation** vacuous: `not(everyInstance(G, c))` is **true** over an empty group, so "show the warning unless every passenger has a passport" shows the warning for a booking with no passengers. That is the same class of surprise pointing the other way, and it is the shape an author is more likely to write by accident, because a warning is usually phrased as a negation. So `rule-sentence.ts` renders a negated `everyInstance` with its own reading out loud ("not every passenger ..., which includes there being no passengers"), and the test bench's zero-instance evaluation covers the negated rule as well as the plain one. Neither is a semantics change: it is the same base case read through `not`, written down where an author meets it.

**What the new operators cost, which is more than three union members.** ADR-03's own Note names the machinery: `packages/core/src/visibility-rule.test.ts` pins the thirteen operators as a hand-edited list checked against the `Condition` union in both directions, and `apps/admin/lib/forms/condition.ts` ties the admin's parallel copy to the same union through a type-only import, "so neither side can move alone". Three new operators therefore mean a deliberate edit to that test, taking its list to **sixteen**, a matching edit to the admin's list, a changeset, and ADR-03's amendment. ADR-03 also says new operators are versioned core changes, and its second Note records that there is still no DSL version constant, so "versioned" stays a review convention.

**Depth.** `CONDITION_MAX_DEPTH` stays 8 and the nested condition of `anyInstance` and `everyInstance` counts toward it, which `conditionDepth` reaches by recursing into the new nodes like it recurses into `not`.

**Forward-only (ADR-16, I10) with a group in it.** `documentOrder` expands a group into a contiguous span of its member questions, in order. Three rules follow, all enforced by `analyzeRuleGraph` with existing error codes where the existing code fits:

1. A rule targeting inside G may read questions before G and questions earlier **within the same instance**. A reference to a later position inside the instance is `RULE_BACKWARD_TARGET` exactly as it is today.
2. A rule using `anyInstance`, `everyInstance` or `instanceCount` over G reads **the whole of G**, so its targets must appear strictly after G's whole span. This is the existing rule applied to a span rather than a position. **If such a target sits inside another group H, the rule is additionally refused when `max_H x max_G` exceeds `REPEAT_EVALUATION_BUDGET`** (`REPEAT_EVALUATION_BUDGET_EXCEEDED`), which is the cost bound the paragraph below states and not a cap on either group's size.
3. A `fromAnswer` count source is a read of its count question by the whole group, so the count question must precede the group's span. `REPEAT_COUNT_BACKWARD_REF`.

No rule may read a **different** instance of the same group. That is not a restriction the design chose so much as one the forward pass requires: instance order is a roster order and not a document order, so "the previous passenger's answer" has no forward-only reading.

**Cost bound, and it is a product of two maxima rather than one.** One pass still: the outer walk is over steps, and a group's span is walked once per live instance. For a rule whose target sits outside every group, or inside the same group it reads, the cost is `rules x max` and that is the whole of it.

**But one rule shape is quadratic, and an earlier draft of this section stated the bound as if it were not.** Forward-only rule 2 lets a rule using `anyInstance`, `everyInstance` or `instanceCount` over group G target anything after G's span, and that includes a question inside a **later group H**. Such a rule is evaluated once per live instance of H, and each of those evaluations walks the whole of G, so its cost is **`max_H x max_G`**. With no installation-wide ceiling (Q14) two groups at `max: 5000` put twenty-five million leaf evaluations behind one rule, on every answer write, every step read and every submit, triggered by a respondent. Stating the bound as `rules x max` was simply wrong, and this is what it should have said.

**Ruled 2026-09-29 (Code Owner): that shape is refused at publish when it exceeds a fixed evaluator budget.** A rule whose target sits inside group H and whose condition applies a whole-group operator over another group G is refused when `max_H x max_G` exceeds **`REPEAT_EVALUATION_BUDGET`**, a fixed constant in core, with the publish code **`REPEAT_EVALUATION_BUDGET_EXCEEDED`** naming both groups, both maxima and their product. Three things about it are worth stating precisely, because the distinction is what keeps it consistent with Q14:

- **It is a cost bound, not an instance ceiling.** It caps no group's `max`. A group may declare any `max` it likes and both of two groups may be large; what is refused is the one **rule shape** whose cost is their product. Q14 stands: there is still no installation-wide ceiling on instance counts, and a form with two groups at `max: 5000` and no cross-group rule publishes.
- **It is checked at publish, against declared maxima**, not at runtime against live counts, which is the property ADR-16 exists to protect: the cost of serving a published version is known before it is published.
- **It is per whole-group read, and that bounds a rule because whole-group reads cannot nest** (corrected 2026-09-29 by Q25, which is what makes this bullet true). The constant is charged against each pair of `(target group, group read)`. That bounds a **rule** only because a whole-group operator may not sit inside another's condition: with nesting refused, a rule's whole-group reads are siblings under `and`, `or` and `not`, so their costs **add** and the rule's worst case is the budget times how many it carries. While nesting was unlimited they **multiplied** instead, and `anyInstance(G, anyInstance(H, c))` cost `max_G x max_H` whatever the rule targeted, which the pairwise charge never saw. Two cross-group rules each within budget are still both allowed, and the per-request total is the per-rule bound times the rule count, which the rule count itself bounds in the ordinary way.

**Confirmed value: `REPEAT_EVALUATION_BUDGET = 10_000`** (Code Owner, 2026-09-29), with the reasoning kept because a constant is easier to revisit with its argument beside it. One leaf evaluation is a comparison against a resolved answer, and `CONDITION_MAX_DEPTH` is 8, so one condition evaluation is at most a few dozen leaf comparisons; 10,000 instance pairs is therefore of the order of 10^5 comparisons for the worst rule in the worst form, which is sub-millisecond to low-millisecond work on the request path and comparable to what a single step's validation already costs. It admits every shape either sample use case wants by a wide margin: nine passengers against twenty income sources is 180, and a hundred against a hundred is 10,000 exactly. It refuses 5000 by 5000 by three and a half orders of magnitude, which is the case it exists for. It was put to the Code Owner as a proposal and **confirmed as written on 2026-09-29**, on the reading that unlike the removed instance ceiling it limits nothing an author may model, only one rule shape's cost, and that the tolerable value is a question of how much request-path CPU a deployment will hand a respondent.

### 3.5 `FlowState`, and the one place additivity is awkward

_Ruled 2026-09-29 (Code Owner), as recommended (Q8): parallel optional fields now, and the tidy-up is recorded as the first job of multi-version evaluation._

`FlowState` is a `z.object` and it is what every golden scenario's `expected` block asserts with `toEqual`. Widening `visibleSteps` from `StepId[]` to `{stepId, instanceId}[]`, or `missingRequired` from `QuestionId[]` to `{questionId, instanceId}[]`, would fail every committed scenario (51 of them at `c1988256`) and would need the `SEMANTICS_VERSION` bump that cannot be taken.

**Every new field is optional and is omitted entirely when the form holds no repeating group.** The existing **six** fields (`visible`, `visibleSteps`, `currentStep`, `answeredRequired`, `missingRequired`, `complete`) keep their exact shapes and their exact contents for a form with no group.

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

This is the ugliest part of the design and the plan says so rather than hiding it: two parallel arrays exist because one of them cannot change shape. The alternative was put to the Code Owner as **Q8**: build multi-version evaluation first, bump `SEMANTICS_VERSION` to 2, and widen the fields properly. That is a larger, separate piece of work with its own value, since it unblocks every future semantics change, which ADR-16's Note calls out as the standing limitation, and it would make this design cleaner. **The ruling takes the parallel fields now and records the tidy-up as the first job of multi-version evaluation**, which ADR-16's amendment carries so that the debt has a named creditor rather than a hope.

### 3.6 Removal, and why it reuses a semantic that already exists

_Ruled 2026-09-29 (Code Owner), as recommended (Q5)._

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

**The separator.** `ins_7k2/q_passport` uses `/`, which no branded id may contain, so the encoding parses without a schema. It is a legal HTML `id` and a legal fragment, and it needs `CSS.escape` in a selector, which the shared jsdom setup already polyfills for react-aria. `__` was the alternative, needing no escaping but adding a rule about what a branded id may hold and reading like the `__qk__` and `__qa__` marker prefixes; Q15 ruled for `/`.

### 4.2 The no-JS path

_Ruled 2026-09-29 (Code Owner), as recommended (Q9): named `__qop` submit buttons carrying `formnovalidate`, with instance-qualified field names. **A second ruling of the same date settles what such a post does:** an Add or Remove applies **only the roster operation** and commits **no answers**. That is the ruling this section is written to, and it is what keeps the 2026-09-13 ruling on browser validation intact._

This is the hardest part of the design, because nothing in the portal handles a non-submit action button today, and the no-JS claim in `docs/portal-constraints.md` is unqualified with an empty exception list.

**The mechanism is a named submit button.** A `<button name value>` contributes its name and value to the form data set **only when it is the button that submitted the form**, which is what lets one form carry several distinct operations without scripting. So the step form gains:

```html
<button type="submit" name="__qop" value="add:grp_passengers">Add passenger</button>
<button type="submit" name="__qop" value="remove:grp_passengers:ins_7k2">Remove passenger 2</button>
```

The whole-step POST therefore carries every field on the step **plus at most one `__qop` value**. The BFF's `decodeStepForm` gains a fourth reserved prefix beside `__qk__`, `__qa__` and the honeypot's `website`.

**An Add or Remove post applies the roster operation and commits nothing else** (Code Owner, 2026-09-29). This is the part an earlier draft of this section got wrong: it said the route "applies the answers first and the roster operation second", which would write a whole step's answers to the ledger on a button press that is not a Continue. It does not. The ruled behaviour is three sentences:

1. **The roster operation is applied.** It is server state and the only thing the post is for.
2. **No answer is written.** The typed values ride the post, are carried back for the re-render, and reach the ledger only when the respondent presses Continue, under the ordinary validation the ordinary Continue does.
3. **Validation is therefore not skipped, it is deferred.** Nothing is accepted, so nothing can be accepted wrongly, and the respondent sees their typed values again beside an unchanged step.

That is what makes `formnovalidate` safe rather than merely convenient (see below), and it is why **`docs/portal-constraints.md` needs no exception for this path and no change to its "a required question cannot be CLEARED without scripting" bullet**: an empty required field on an Add post is not a retraction, because no answer write happens at all. The bullet stands exactly as the 2026-09-13 ruling left it, and 073 asserts that rather than amending it.

**The Add and Remove buttons carry `formnovalidate`, and that is not a detail.** Every other control on the step keeps browser validation, which is the Code Owner's 2026-09-13 ruling on issue #920. But a respondent who has filled passenger 1 and wants passenger 2 would be refused by the browser for passenger 1's blank passport, and pressing Add would do nothing with nothing said, which is the class of dead end that issues #920, #18 and #988 each closed once. `formnovalidate` is a submit-button attribute in the HTML standard for exactly this, so the Add and Remove buttons submit unvalidated.

**And because no answer is written on that post, `formnovalidate` gives up nothing the 2026-09-13 ruling was protecting.** That ruling keeps browser validation so that a respondent is told about a bad or empty required field before the page leaves, and so that a required answer cannot be cleared without scripting. Both survive: the Add post writes no answer, so an emptied required field on it is neither stored nor retracted, and the field comes back still empty with the step unchanged. The validation the respondent must pass is the one on **Continue**, which keeps `required` on every control and is validated again by the API. What `formnovalidate` buys is only that pressing Add is not refused by a constraint on a field the respondent has not finished with.

**No repeated field names.** The decoder's `partition()` already accumulates a repeated name into a `string[]`, but only the `multi` kind consumes more than `raws[0]`, and relying on duplicate-name ordering would couple the wire to DOM order, which a removal reorders. The HTML standard is firm that entries are built "in tree order" and that order survives serialisation, but it is firm **per name only**: an unchecked checkbox and an unselected radio contribute no entry at all, so one column's list runs short of another's and positional zipping across columns is unsafe. The spec offers no indexing mechanism, which makes indexed names an application convention either way. Every instance's field therefore carries a unique qualified name, and the decoder needs no ordering rule at all.

**One call per answer is not acceptable at nine passengers.** `forwardAnswers` makes one `POST /sessions/{id}/answers` per decoded answer, sequentially, and each one takes a per-session advisory lock and re-evaluates the flow. Nine passengers times six questions is fifty-four round trips for one Continue. Q20 ruled for a batch answer endpoint for this reason; it is an internal contract with no stability promise, and the batch is also what makes the roster operation and the answers one transaction. **The same ruling puts the fix for issue #968 in the same work**, because the batch is where the answer path's lock ordering is decided.

**The re-render cookie will not hold, and the two paths need two different answers.** `qcms_step_ctx` is one JSON cookie, 15 seconds, httpOnly, carrying `values`, `errors`, `constraints` and `missingRequired`, all keyed by question. Browsers cap a cookie at roughly 4 KB. A nine-passenger step with an error on each instance exceeds that, and a cookie that silently fails to set produces a re-render with the respondent's answers missing, which is the worst failure this document can name.

**On the Continue path, Q21's ruling holds and one thing is added to it.** The re-render takes `values` and `missingRequired` from the API's own step projection, which already returns both, and the cookie keeps only the 422 constraint errors, capped, with the ruled behaviour on overflow: the oldest entries are dropped, the re-render says that some messages could not be carried, and the respondent reaches the full report by pressing Continue again. **What is added is that a refused value has to come back with its error.** The API's projection holds accepted answers only, so a value the API refused with a 422 is in neither the projection nor, as Q21 was first written, the cookie, and the cell would re-render **blank beside an error message about what the respondent typed**. That is the WCAG 3.3.7 Redundant Entry failure this document names two sections down, arrived at from the other side. So the capped cookie record is **`{error, constraint, value}` per refused field**, not `{error, constraint}`, and the cap is **stated in fields rather than in bytes** so that it is checkable: the route counts refused fields, keeps the first N, and reports the overflow in the ruled sentence. Only refused fields need a record, so the set is bounded by how many the API rejected rather than by the step's size.

**On the Add and Remove path, nothing was accepted, so the API's projection is not the carrier.** Every typed value on the step has to survive the round trip or the respondent loses the step's work on a button press, which is both 3.3.7 and the worst failure named above. The cookie cannot be the carrier here, because the set is the whole step rather than the refused subset, and the whole step is exactly what does not fit in 4 KB at nine instances; capping it would mean dropping answers, which is the one outcome this design refuses. **The carrier is therefore the POST body itself: the `__qop` request re-renders the step in its own 200 response rather than redirecting.** Every typed value is already in the post, so nothing has to be carried anywhere.

**The mechanism that produces that 200 is a Next Server Action** (Q28, ruled 2026-10-01), and it is the only one: a page in Next's App Router answers GET and HEAD, a route handler cannot render the page, and one segment cannot hold both. The action is attached to the step's `<form>` and Continue carries a plain URL `formaction`, which keeps React away from the `__qop` buttons entirely - they stay ordinary `<button name value formnovalidate>` markup, which is what Q9 ruled and what needs no framework behaviour to serialize. `useActionState` is what carries the action's return value into the render. Two consequences ride with it: the portal's `Referrer-Policy` moves to `same-origin`, because Next's action check refuses the `null` origin that `no-referrer` produces; and the action runs SEC-9's belt itself, because Next's check admits a missing `Origin`, ignores the scheme and never reads `Sec-Fetch-Site`.

That trades the redirect away, and the cost has to be paid rather than hidden: a POST whose response is a page can be replayed by a reload or by Back, and replaying an Add would add a second instance. **So the roster operation carries a one-time operation token.** The rendered page mints a token into each `__qop` button's value (`add:grp_passengers:op_7f3`), the API records the token with the roster row, and a token it has already applied is a no-op that returns the current roster. A reload then re-renders the same step with the same instances, which is the behaviour a respondent expects and the reason the 303 existed. The token is not a credential: it is scoped to the session it was minted in, it is worthless to anyone who cannot already post to that session, and refusing a replay is its only job.

**The browser interposes itself first, and that cost is stated rather than discovered.** Reloading a page that is the response to a POST raises the browser's own resubmission confirmation ("Confirm Form Resubmission" in Chromium, a re-POST prompt in Firefox), and navigating Back to such a page can show a "Document Expired" interstitial in Firefox rather than the page. Neither is something the server can suppress, and on the no-JS path it lands on the respondent least equipped for it. The token is what makes the outcome safe: if the respondent confirms, the same token is replayed and the roster operation is a **no-op**, so nothing is added twice and the step comes back as it was. This is a stated consequence of a confirmed mechanism rather than a reason to revisit it, because the alternative was cookie carriage of a whole step's values and that was refused for the size reason above. **073's browser suite asserts the no-op** rather than leaving it to be found.

**This is a departure from the 303 that an earlier draft of this section described**, and it is recorded as one. The mechanism, the 200 re-render together with the one-time operation token, was put to the Code Owner and **confirmed on 2026-09-29**. The alternative was cookie carriage of the whole step's values, which was rejected for the size reason above; a third option, writing the answers so the projection could carry them, is what the 2026-09-29 ruling refuses. The Continue path keeps its 303 and its cookie, unchanged apart from the `{error, constraint, value}` record, so exactly one path in the portal answers a POST with a page and it is the one that committed no answers.

### 4.3 Accessibility

_Ruled 2026-09-29 (Code Owner), as recommended (Q11): the APG focus destinations, a status region on the JS path, and a fragment landing on the no-JS path._

The floor is WCAG 2.2 AA and the portal's manual screen-reader pass (task 030) is a Code Owner human gate. Section 13 records the sources.

- **Instance grouping.** Each instance is a `<fieldset>` whose `<legend>` carries the resolved instance label, with the same text as a heading inside it so the instance is reachable by heading navigation as well as by group. This is the WAI forms tutorial's own worked example (two same-shaped address blocks distinguished by their legends) and technique H71's rule of thumb: a group inside a larger form that needs a heading of its own. **The legend stays short**, because the tutorial warns that some screen readers read the legend with every control in the group, and each control's own label stays self-explanatory for the configurations that never read it. 1.3.1 Info and Relationships, 2.4.6 Headings and Labels.
- **Focus after add.** Focus moves to the new instance's heading, which carries `tabindex="-1"`. Without scripting the same landing is the **`autofocus` attribute** on that heading (Q28, ruled 2026-10-01), and not a fragment: section 4.2's response is a 200 to a POST, which leaves the browser on the POST's own URL and so carries no fragment at all. `autofocus` applies to every element rather than only to form controls, and a negative `tabindex` makes a heading a focusable area, so the heading is a legal target. **The two may never both appear**: the flush algorithm skips `autofocus` outright when the document has a fragment target. Verified in Chromium and Firefox with scripting disabled, including on a 200 answering a POST. 2.4.3 Focus Order.
- **Focus after remove: three destinations, in this order** (Q11, ruled 2026-09-29). APG's keyboard-interface practice names the first in terms, for exactly this case: after "a destructive operation like deleting an item from a list", focus goes to "the list item following the deleted item", and its reasoning is the screen-reader one, that hearing the next item confirms the deletion and makes a second deletion efficient. The ruled order is therefore:
  1. the heading of the **instance that took the removed one's position**;
  2. failing that, because the removed instance was the last, the heading of the **previous instance**;
  3. failing that, because the removed instance was the **only** one, the **Add button**, which is then the only candidate left on the page.
     **An earlier draft of this plan recommended the Add button in every case and was wrong**, and an intermediate draft named the Add button as the fallback for the last instance, which is the second case above rather than the third. Two gaps are worth stating rather than papering over: APG addresses a scripted DOM removal and says nothing about the last-item or only-item cases, so destinations 2 and 3 are this plan's reading of its reasoning rather than its words; and **no source found addresses focus after a full-page POST-redirect-GET**, so the no-JS landing is a design decision this plan takes rather than a citation it makes. The only-instance case can arise only in a group whose `min` is 0, since a group at `min: 1` refuses the removal that would empty it.
- **Announcement, on one path only.** With scripting, a `role="status"` region says "Passenger 3 added" and "Passenger 2 removed, 2 passengers remaining", written as the whole sentence rather than as a changing number, because 4.1.3's own Understanding warns that updating only the digit in "3 items" can announce just "three". Without scripting, **4.1.3 does not apply**: the criterion explicitly scopes out messages "delivered via a change in context", and a whole-page POST and re-render is a change of context that assistive technology already surfaces. So the no-JS path needs no live region, and that is a citation rather than an omission.
- **Error summary naming the instance.** The existing summary is a `role="alert"` block of in-page anchors keyed by question. Each entry gains the instance label: "Passenger 2: passport number is required", anchored at the qualified field id. 3.3.1 Error Identification, with 3.3.3 Error Suggestion where the constraint has one.
- **Naming the per-instance controls.** APG's naming practice says to put the distinguishing words first, so the control is named **"Remove passenger 3"** and never "Passenger 3 remove".
- **No dragging.** Instances are not reorderable at launch. If reordering is ever added it needs a single-pointer non-dragging path (2.5.7 Dragging Movements), which is the criterion issue #680 already caught the admin's option grid on.
- **Target size.** Add and Remove are controls at the portal's `--space-control-h` floor of 44px, above 2.5.8's 24px minimum, and a per-row Remove in the table presentation is the control most likely to fall below it.
- **Focus not obscured (2.4.11).** New at 2.2, and it bears here through **sticky table headers and a sticky column-total footer**, which are exactly the "sticky footers, sticky headers" its Understanding names. A table presentation that pins its header row has to prove a focused cell in the first visible row is not hidden by it.
- **Redundant entry (3.3.7)**, new at 2.2, bears twice. It is the criterion an author violates by splitting a group across two steps and asking for the same passenger twice. And it bears on the round trip itself: the criterion covers information "required to be entered again in the same process", so a POST that came back having lost the other instances' answers is a conformance failure and not only a bad experience.
- **On input (3.2.2)** decides one small thing. An explicit **Add another** button is outside the criterion, because activating a button is not changing a setting. A count `<select>` that submitted on change would be inside it, which is one more reason the count question is an ordinary question answered with an ordinary Continue.
- **Two of the new 2.2 criteria do not bear, and are listed so a reviewer does not look for them.** 3.3.8 Accessible Authentication applies to authentication steps only. 3.2.6 Consistent Help governs help mechanisms repeated across a page set and its Understanding is explicit that it is "distinct from ... instructional text in a form"; it binds the step chrome's ordering across re-renders and nothing inside the group.

### 4.4 The stacked presentation

_Ruled 2026-09-29 (Code Owner), Q12, first half: the stacked presentation renders **one input per row** and allows **every** question type._

The stacked presentation is one instance card after another, and inside a card it is **one input per row: a single column, with no two fields side by side at any width**. That is a ruling and not a default, so it is stated here in the terms an implementer and a reviewer both need:

- **No two-up layout at any breakpoint.** Not at a desktop width, not in the admin preview, not in a card that happens to hold two short fields. The passenger concept page draws given names beside surname, and that layout is superseded; the card is a single column from 390px to the widest viewport the portal renders at.
- **Why it is a rule rather than taste.** Two reasons, and the first decides it. A side-by-side pair inside a repeated card makes the reading order and the tab order diverge from the visual order the moment a rule hides one of the pair in one instance and not in another, which is exactly what per-instance branching does (section 1.1, the infant fare basis). And a single column is the layout the phone already gets, so one column everywhere is one layout to prove rather than two, which is the same reasoning `playwright.config.ts` encodes by running every spec on the Pixel 7 project.
- **Every question type is allowed**, including `longText` and `multiChoice`. That is the asymmetry with the table presentation and it is deliberate: a stacked card gives a control a full row, so nothing about a textarea or a checkbox group is cramped in it. An author refused a column type in a table is pointed at this presentation, by name, at the point of refusal.

### 4.5 The table presentation

_Ruled 2026-09-29 (Code Owner), as recommended: a native `<table>` and never `role="grid"` (Q10), and five cell types (Q12, second half)._

**Use a native `<table>`, not `role="grid"`.** Three of the four reasons are citable and the fourth is this product's own.

1. **A grid cannot exist without scripting.** APG states it as a defining property of the pattern: a grid "Requires the author to provide code that manages focus movement inside it", and only one of its focusable elements is in the page tab sequence. With scripting off there is no roving tabindex, so a `role="grid"` renders as a tab-trap-shaped nothing. For a surface whose no-JS claim is unqualified, that settles it on its own.
2. **APG prefers the native element.** "As with other WAI-ARIA roles that have a native host language equivalent, authors are strongly encouraged to use a native HTML `table` element whenever possible."
3. **APG's two optimal cell designs exclude a text input.** The optimal pairs are a cell holding one widget that does not need arrow keys (link, button, menubutton, toggle button, radio button, switch, checkbox) with focus on the widget, or a cell holding text or one graphic with focus on the cell. A text field is "editable content", which APG routes through an Enter/F2/Escape edit mode, and it warns that cells outside the two patterns "add complexity for authors or users or both". A four-column assets table is three text-ish columns.
4. **A phone has no grid.** The table reflows to cards at 390px, and a keyboard model that exists only above the reflow width is two interaction models for one question.

**What the table pattern costs, stated as APG states it**, so that nobody reads it later as a defect: "Since a table is not a widget, each widget contained in a table is a separate stop in the page tab sequence", and a grid is what you reach for when "the number of widgets is large". A four-column table of ten rows is forty tab stops. That is the documented, expected behaviour of the choice, and the mitigation is the group's `max` rather than a different pattern. **After the Q14 ruling that is the whole of the mitigation**: with no installation-wide ceiling, the tab-stop count of a table is `columns x max` for whatever `max` its author declared, and nothing in core refuses a large one. Section 13 carries the sources.

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

The table presentation constrains the column types to **five** (Q12, ruled as recommended): `shortText`, `number`, `date`, `boolean` and `singleChoice`. `longText` and `multiChoice` are refused at publish with `TABLE_COLUMN_TYPE_NOT_ALLOWED`, because neither fits a cell and the phone card reflow makes both worse. **The admin points at the stacked presentation by name** at the point of refusal, in the library picker and in the publish error alike, because the stacked presentation allows all seven types (section 4.4) and an author refused here has somewhere to go.

**A vendored `Table` already exists** in `packages/ui/src/components/a2ui/table/` and is exported from the admin Kit, but it is not in the renderer registry and is a read-only display table. It is the right starting point for the markup and the style map, and it is not an input grid.

**One implementation trap, found while building the concept pages rather than reasoned about.** A visually hidden label positioned with `position: absolute` inside an `overflow-x: auto` box resolves against the initial containing block when no ancestor is positioned, so it lands past the viewport edge and widens the **document**, producing exactly the horizontal page scroll the portal forbids. It cost 136 unexplained pixels on one concept page. The fix is one declaration, `position: relative` on the scroll box and on any button carrying a hidden label, and it is worth a paragraph here because this design puts a hidden label in **every** cell, so the trap is structural rather than incidental. A second one from the same build: when an instance card's border is on the `<fieldset>`, the `<legend>` renders in the fieldset's legend slot and cuts the border; `float: left; width: 100%` puts the heading inside the card while `<legend>` stays the fieldset's accessible name.

### 4.6 Mobile

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

_Ruled 2026-09-29 (Code Owner), as recommended (Q16): a new append-only table, `answer_group_instances`._

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

**The live roster is derived from this table and the count, and the derivation differs per count source.** The table records only what was minted and what was explicitly removed; it is not itself the live set for two of the three sources, and an earlier draft of this section said it was:

| Count source | The live roster is                                                                                            | Who shortens it                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `open`       | every `instance_id` whose latest event is `added`, in first-`added` order                                     | nobody; removal is an explicit `removed` row                    |
| `fixed`      | the **first `count`** of that list                                                                            | the derivation, against the group's own `count`                 |
| `fromAnswer` | the **first N** of that list, where N is the current answer to the count question, clamped to `min` and `max` | the derivation, against the count answer as it stands right now |

That is what makes section 3.6's ruled behaviour true: lowering a `fromAnswer` count from 3 to 2 makes instance 3 not-live **with no `removed` row**, so raising it back to 3 re-lives the same instance with its answers intact, while an `open` instance the respondent removed is gone for good and an added replacement is a new id. Both behaviours fall out of the table above rather than being special cases in the code.

**Where the derivation runs: in the API, before `evaluateRules` is called.** The `rosters` map that section 3.2 passes to the evaluator is **already truncated** and holds live instances only, in roster order. The evaluator does not re-derive it and does not read the count answer for this purpose, which keeps the evaluator's contract what it is today (a pure function of what it is handed) and keeps determinism (I7) checkable: the same `(snapshot, answers, rosters)` gives the same `FlowState`, and the truncation is a server-side step above it whose own inputs are the table and the count answer.

**When instances are minted, per source.** An `open` group mints on the respondent's Add, and mints `min` instances (or one, when `min` is 0) the first time the group's step is served, so that the respondent sees a card to fill rather than an empty group with a button. A `fixed` group mints its `count` instances the first time its step is served. A `fromAnswer` group mints on the **write of the count answer**, up to the answered N, and mints the difference on each later raise; it mints nothing at session start, because the count is not known then. Every mint is one appended `added` row, so the minting moment is auditable and idempotent under replay: serving the same step twice mints nothing the second time, because the rows are already there.

Removal appends; nothing updates and nothing deletes. Two triggers mirror the ledger's (`answer_group_instances_reject_update`, `..._reject_delete`, the delete one honouring the same `qcms.allow_answer_delete` door), a CHECK pins the event vocabulary, and one index serves the roster read.

**Why a table and not an answer.** Encoding the roster as a synthetic answer keyed by the group id would reuse the existing table and its triggers, and it was considered. It is rejected because `answers.question_id` would then hold something that is not a `questionId`, which collides with `prepareSubmission`'s `UNKNOWN_QUESTION` ledger-drift defence, with R6's statement about what a `questionId` is, and with the reporting view's contract that a row is a question. Q16 records the trade.

**Consequences that are easy to lose:**

- `migrations.test.ts`'s `EXPECTED_TABLES` is an **exact** set since issue #861, so the new table is added there or the suite fails.
- `eraseSession` gains a delete of this table inside the same transaction and behind the same door, and `purgeExpired` gains the same. An erasure that leaves a roster behind leaves the shape of a respondent's family.
- ADR-40's per-environment generator grows, and by **four** guards rather than the three an earlier draft counted. That record's own criterion is "any trigger, CHECK, UNIQUE constraint or index declared on one of the data-plane tables", and this table declares two triggers, one CHECK **and one index**. **The base it is added to is thirteen, not twelve**: the 2026-09-29 rulings on issue #995 added a thirteenth guard of their own, a `CHECK (environment = '<env>')` on `data_<env>.sessions`, so the reconciled figures are **eight data-plane tables, seventeen guards, eight foreign keys and twenty-five per-environment objects**. Those are written into ADR-40's amendment, into `plan/environments-and-workspaces.md` and into task 064's criteria, because the repetition work landed second and both records said the second lander writes the combined figure.

**The landing order is known and it is worth stating, because the two tracks do not meet as equals.** Repetition is launch scope and environments (064) are Phase 4, so **072 is expected to land first**, and it adds `answer_group_instances` as an ordinary **appended** migration on the existing chain. The Code Owner's Q41 ruling on issue #995 then has task **064 replace migrations 0000 onward with a new baseline**, and that baseline has to include the roster table, its two triggers, its CHECK, its index and its foreign key, which then join ADR-40's per-environment set like every other data-plane object. So 072 does not write anything 064 has to migrate; it writes something 064 has to **carry into the baseline**, and the guard counts this document amends are what 064 checks its generator against. Task 072's work order carries the same paragraph so the fact is where the implementer reads it.

- The two trigger functions stay single in `control`, as ADR-40 already specifies for the answer ledger's pair.

### 5.3 Submission and the locked set

`LockedAnswer` gains an optional `instanceId`:

```ts
type LockedAnswer = { questionId: QuestionId; instanceId?: InstanceId; value: AnswerValue };
```

Ordering is document order for questions and roster order for instances, and `canonicalJson` already preserves array order, with its own doc saying order is meaning. A form with no group produces a byte-identical `LockedSubmission` and therefore a byte-identical `contentHash`, which the committed insurance golden hash asserts for free.

`prepareSubmission` gains `REPEAT_COUNT_OUT_OF_RANGE` and reports `MISSING_REQUIRED` per `(instance, question)`.

**Issue #968 is amplified and is closed in the same work.** That open issue records that the required-answer sweep runs before the session lock, so a concurrent retraction can leave the ledger and the submission out of step. A repeat multiplies the window by the number of fields a step posts, and the no-JS path posts a whole step at once. The Q20 ruling puts the fix in **task 073**, beside the batch answer endpoint, because that endpoint is where the answer path's locking is decided; it is a deliverable and an exit criterion of that task rather than a prerequisite scheduled elsewhere.

### 5.4 The webhook and the outbox, including the redacted form

**Repeated answers stay inside the `answers` member of the payload, and this is not a stylistic preference.** Erasure and the retention sweep both redact by dropping exactly one jsonb key, `payload - 'answers'`, and migration 0016's CHECK `outbox_redacted_payload_has_no_answers` enforces that a redacted payload holds no `answers` key. A design that put repeated content in a sibling member (`groups`, `rows`, `instances`) would escape both the redaction and the CHECK, silently, and the first anyone would know is a subject-access request answered with data that was supposed to be erased.

So the payload's `answers` becomes `LockedAnswer[]` with the optional `instanceId`, exactly as the locked set is. Nothing else in the envelope changes, the HMAC signing is unchanged, and `docs/webhooks.md` gains an example.

**The redacted payload carries nothing new** (Q19, ruled 2026-09-29 as recommended). No instance ids, no roster, and **no counts**. A count is not an answer, but "how many dependants", "how many liabilities" and "how many passengers" are disclosive on their own, and the CHECK's guarantee is cheapest to keep as "the payload after redaction holds no respondent-derived value of any kind". That is a decision rather than an omission, and SEC-16 records it beside the rest of the repeat bounds so the next person to add a field to that payload reads the rule rather than the absence.

### 5.5 CSV export

`questionIdsInDocumentOrder` is built on a premise the code states out loud: "A questionId is pinned at most once across a form (a parse invariant), so the result is duplicate-free." That premise survives (section 3.1 keeps the refinement), but one column per question does not: an open-ended group has no column count until the data is read, and a column set that depends on the data rather than on the form version is not a contract a consumer can bind to.

_Ruled 2026-09-29 (Code Owner): **both shapes ship.** The plan recommended the long shape alone; the ruling keeps it as the **default** and adds the indexed wide shape as an **export option** the person taking the export chooses._

**The long shape is the default.**

- `responses.csv` is unchanged for every question outside a group, with the same metadata columns, the same document order, the same BOM and CRLF, and the same golden byte test.
- One extra file per repeating group, named for the group: `session_id, instance_ordinal, instance_id, <one column per member question in document order>`, one row per `(session, live instance)`.
- A form with at least one group exports as a zip of those files; a form with none exports exactly the single file it exports today, so no existing adopter's pipeline moves.
- `@roonga/qcms-csv`'s formula-injection guard (issue #470) and the `;` join for multiChoice apply unchanged in the new files.

**The wide shape is an option on the same route.** The export request carries a shape parameter beside the `version` parameter CSV already requires; the default is long and the alternative is indexed wide columns, `q_passport__1` through `q_passport__<max>`, folded back into the single `responses.csv` so that a form with groups exports as one flat file and not as a zip. Every column of an instance beyond a session's live count is empty, and the formula-injection guard and the multiChoice join apply there too.

**What the wide option costs, and it is documented rather than discovered.** This is the reason the plan recommended against it, and the reason it is a named option rather than the default:

- **The header depends on each version's `max`, not on the data.** A group with `max: 500` produces 500 columns per member question whether any session filled two of them or none, so a four-question group at that bound is 2000 columns before the metadata.
- **The header changes when `max` changes.** Raise a group's `max` in a later form version and that version's wide export has more columns than the previous version's, silently, from the consumer's point of view. The export route already requires a `version` parameter for CSV precisely because the column set depends on the version's shape, so the mechanism that makes this survivable already exists: a wide export is pinned to one version and a consumer who automates one must pin the version they bound their pipeline to. **That sentence is documented on the export screen and in `docs/` beside the route**, not only here.
- **It is per version and not per export.** Two versions of the same form can produce two different wide headers for the same group, which a long export cannot do, because a long file's header is the member question list rather than the member question list times a bound.

Under the Q14 ruling there is no installation-wide ceiling above `max`, so nothing in core stops an author declaring the 500 that produces those 2000 columns. That makes the documentation above load-bearing rather than cautionary, and it is why the long shape is the default the export screen offers first.

### 5.6 Reporting view

_Ruled 2026-09-29 (Code Owner), as recommended (Q18): a nested array per group in `reporting.responses.answers`, and `jsonb_object_agg` must stop collapsing duplicates._

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
- **What genuinely changes is the volume.** A nine-passenger booking holds nine names, nine dates of birth and nine passport numbers in one session, so one erasure request and one retention miss are both nine times as consequential. That is an argument for the per-form bound of section 8 and for nothing else in the model.
- **SEC-13 redaction is unchanged and already correct.** The span and log allowlists permit branded ids as pseudonymous correlators and delete everything unlisted, so `ins_` joins `q_`, `frm_`, `stp_` and `ses_` as a permitted correlator and no value follows it. The logger's own test asserts that `answer` and `answerValue` fields do not survive; nothing about a repeat changes what that asserts.

---

## 6. Authoring

### 6.1 The question editor does not change

A question does not know it is repeated. `QUESTION_TYPES` is unchanged, `ConstraintsView` is unchanged, `QuestionDefinitionView` is unchanged, the option grid is unchanged, and `scripts/component-registration.test.ts`'s eight registration sites are unchanged, because no component is registered. That is the single largest practical dividend of recommending T2 over T1, and it is worth stating where an implementer will look for it.

### 6.2 The form builder

`DraftStep.items` widens from `DraftPin[]` to a union with a draft group, mirroring the kernel. The pure mutations in `apps/admin/lib/forms/draft.ts` gain the group operations (`addGroup`, `removeGroup`, `addPinToGroup`, `movePinWithinGroup`, `setGroupCount`, `setGroupPresentation`), following the file's existing shape: the component holds the draft and every mutation is a pure function tested on its own.

The group panel carries, in this order: name and group id, the member question list (the same ownership grid the step editor already draws, so form-owned cells get controls and library-owned cells are text), the count source as a three-way radio with a question picker for `fromAnswer`, `min` and `max`, the instance label template with a live preview, and the presentation as a three-way radio. **`max` is a required field on `fromAnswer` and on `open`** and the panel says so where the author sets it rather than leaving the refusal to publish; a `fixed` count shows no `max` at all, because the count is the bound.

`step-editor.tsx` and `lib/forms/pin-grid.ts` gain group boundaries in the grid. `rail-steps.tsx` and `lib/forms/subtree-rail.ts` gain a group node in the rail tree.

### 6.3 The table question editor

Under T2 there is no table question, so the "column editor" is the group's member list rendered as columns: each row is a column, showing the column label, the underlying question and its type, with the type shown rather than chosen (it is the question's own type). Adding a column is adding a question to the group; the picker filters the library to the allowed cell types (Q12) and says why the others are absent. The whole editor is therefore a second view of one list, which is what keeps the author's two mental models (a group and a table) from becoming two data models.

### 6.4 The rules editor and the test bench

- **Scope is shown, not authored.** When a rule's target sits inside a group, the editor states it on the rule: a chip reading "evaluated per passenger", using the group's label. The author writes an ordinary condition. `lib/forms/rule-sentence.ts` gains the sentence forms.
- **All three new operators get structured editors.** `anyInstance` and `everyInstance` are each a group picker plus a nested condition, reusing the existing nested-condition editor and its depth accounting. `instanceCount` is a group picker, a comparison picker and a number. **The `everyInstance` sentence states its own reading** ("every passenger ..., and there is at least one passenger"), because the empty-group case is false by decision (Q7) and an author reading the bare sentence would supply the classical reading instead.
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

**Published forms.** Nothing moves. A published version is immutable (R1), its stored compiled documents are served verbatim (ADR-18), and a snapshot published before the move keeps parsing because every new field is optional or absent. Note that the stamp is not stored: the API writes `SNAPSHOT_SCHEMA_VERSION` from the constant at read time, so nothing in the database has to be read back at the old number. A session pinned to an old version behaves exactly as it does today (ADR-07, I4).

**Ids.** `questionId` and `optionId` are untouched, so R6 and I8 are untouched. Two new id kinds appear: `grp_` is a **form-scoped** id, permanent within a form the way `stepId` is, and `ins_` is a **session-scoped** id that is never reused across sessions and never renumbered within one.

**Changing a form so that a question moves into or out of a group** is a change to the form, not to the question, so it produces a new form version and touches no published one. The question's own definition and version are unaffected, which is the property that lets the same library question be single in one form and repeated in another.

**Golden corpora, both of them, appended and never edited.**

- `packages/core/golden/evaluator/`: new scenario files for per-instance visibility, `anyInstance`, `instanceCount`, `everyInstance` over a matching, a mismatching and an **empty** group, a removed instance's answers excluded, a shrinking `fromAnswer` count, and `min`/`max` at submit. Each needs a corpus-local form and, where a new question shape is wanted, a corpus-local question. **No existing `expected` block is edited**, which section 3 makes possible and `CORPUS.md` makes mandatory.
- `packages/a2ui-compiler/golden/`: the documented spec-bump procedure opens a new generation for the `A2UI_SPEC_VERSION` move, carrying the seven existing forms across unchanged plus new repeat and table forms. The append-only guard covers both trees and the `check:golden-append-only` script is what enforces it on every run.

**The template mirror.** `packages/create-qcms-app/templates/common/apps/api/src/features/responses/serve-step/handler.ts` is a byte-identical vendored copy of the API's answer write path, and `pnpm check:templates` fails when the two drift. Every task touching that handler carries the mirror.

---

## 8. Security and abuse

_Rewritten to the Q14 ruling of 2026-09-29. **The plan recommended two installation-wide ceilings, 100 instances per group and 200 per session, as core constants. The Code Owner ruled both out.** There is **no installation-wide ceiling**: bounds come solely from each group's author-set `max`, which Q4 as amended makes required on every count source that is not `fixed`, and which publish and the API both enforce. The request-size and rate limits that already exist are kept as they are; no global cap is invented._

**The control, in one sentence.** A repeating group's size is bounded by its own `max`, declared by the author in the form version, refused at publish if absent, and enforced by the API on every add. That is the whole ceiling. SEC-16 in `docs/SECURITY_DESIGN.md` is the normative statement of it.

### 8.1 What a per-form bound does and does not buy

**What it buys.** The bound is in the form version, so it is immutable once published (R1), visible to anyone reading the version, refusable at author review, and different for a nine-passenger booking and a twenty-holding portfolio without a setting anybody has to tune. A per-form bound is also the only bound that can be right: the plan's recommended 100 would have refused a legitimate large portfolio and permitted a hundred-passenger booking, which is the shape of every number chosen for all forms at once.

**What it does not buy, stated plainly because the ruling removes a control this document recommended.** With no installation-wide ceiling:

- **The payload is bounded per form.** A whole-step POST for a group of `max` instances and `m` member questions carries `max x m` fields plus their two marker companions each. At `max: 9` that is small; at `max: 5000` it is not, and nothing in core refuses the author who wrote 5000.
- **The tab-stop count in a table (Q10) is bounded per form.** A native `<table>` puts every cell in the page tab sequence, so the count is `columns x max` and the mitigation is the author's `max`. That makes an accessibility property an authoring decision, which is worth stating rather than discovering.
- **The POST size is bounded per form**, and so is the field count, subject to the ordinary request limits below.
- **The evaluator's cost is bounded per form, and for one rule shape it is a product of two maxima.** In one forward pass (section 3.4) an ordinary rule, whose target sits outside every group or inside the group it reads, costs `rules x max` with `max` taken from the group's own value. **A rule targeting inside group H whose condition applies `anyInstance`, `everyInstance` or `instanceCount` over another group G costs `max_H x max_G`**, because it is evaluated once per live instance of H and each evaluation walks the whole of G. That single shape is refused at publish when the product exceeds **`REPEAT_EVALUATION_BUDGET`**, confirmed at **10,000** instance pairs, with `REPEAT_EVALUATION_BUDGET_EXCEEDED`. It is a **cost bound and not an instance ceiling**: it caps no group's `max`, and two large groups with no cross-group rule between them publish, so the Q14 ruling stands. Everything else about the cost is per form and unbounded above by anything in core. One forward pass, still, and its worst case is the author's declared one.
- **A session's total is bounded per form, by summation.** A form with four groups can hold the sum of their four maxima in live instances, and no per-session total stands above that sum.

None of those is a hole; each is a bound that moved from the installation to the form. The consequence a reviewer should hold onto is that **an author's `max` is now a security-relevant field**, and the place it is reviewed is form review rather than a core constant.

### 8.2 The controls that do exist

1. **`max` is required and enforced twice.** Publish refuses a `fromAnswer` or `open` group with no `max` (`REPEAT_MAX_MISSING`); the API refuses an add that would exceed the group's `max`, and refuses a `fromAnswer` count above it at the count question rather than at the loop. A `fixed` count is its own bound and needs no second number.
2. **Request-size and rate limits are kept exactly as they are.** The step route runs under the limits the ADR-12 abuse baseline and the deployment already impose; the answer endpoint is already rate limited per session and per IP, and every one of those limits is per process, with the replica-count property §8 of `docs/SECURITY_DESIGN.md` records. Nothing here raises, lowers or re-scopes them, and nothing here adds a new global cap dressed as a limit.
3. **The roster operation gets its own rate limit.** Adding an instance is a distinct action that is cheap to repeat, so it is limited like the answer write rather than riding it. Under ADR-40 rate limits stay installation-wide (finding F6), so this is one more typed setting and not a per-environment one. This is a limit on the **rate** of a bounded operation, not a second ceiling on its size.
4. **Ledger growth per session is respondent-controlled within the author's bound.** Retention is the backstop and is unchanged; the sweep's cost model changes with the volume, which is worth measuring rather than asserting.
5. **The honeypot is per step and stays per step.** The compiler emits one decoy node per step document (ADR-12, the ADR-01 Note). A repeat must not clone it, which is a real risk given that expansion is a template clone: the decoy sits outside the `RepeatGroup` template, and a test asserts that a ten-instance step carries exactly one.
6. **PII volume, not PII kind.** Section 5.7. The erasure path already reaches every table; what the bound governs is how much there is to erase.
7. **SEC-13 needs one addition and no exception**: `ins_` joins the permitted branded-id prefixes in the span and log allowlists as a pseudonymous correlator. No value, no count and no label follows it.
8. **The origin belt (SEC-9)** covers the roster operation, and after Q28 it covers it explicitly rather than by inheritance. The scripted path's roster write is an ordinary belted BFF route like the answer write beside it. The no-JS path's is a **Next Server Action**, which is not a route handler, so it calls the belt itself (ruling R-B2, 2026-10-01): Next does check an action's origin, and that check admits a request carrying no `Origin` at all, compares the host while ignoring the scheme, and never reads `Sec-Fetch-Site`. Both origin gates enumerate `"use server"` modules beside route files so the claim is derived rather than remembered.
9. **Erasure's completeness claim** is only as good as its table list, and the list is hand-kept. Adding a table to the data plane without adding it to `eraseSession` is a silent gap, which is why section 12 makes it an exit criterion with an assertion rather than a deliverable with a checkbox.

### 8.3 Where this is recorded

**SEC-16, "repeating-group bounds"**, in `docs/SECURITY_DESIGN.md`: the per-form `max` rule, the deliberate absence of a global ceiling and what that leaves bounded per form, the `ins_` id prefix as a permitted correlator, and the abuse bounds above. It is a new control number rather than a paragraph inside an existing one because it is a statement about what is **not** controlled as much as about what is, and that is the kind of thing a reader has to be able to cite.

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

## 10. The questions, and the rulings

**All twenty-three were ruled by the Code Owner on 2026-09-29.** The table gives the ruling beside the recommendation the question was put with, and flags the **five that differ**. Each entry below then states the ruling, what it changes, and, where it differs, one line naming what was recommended instead. Seven of the questions were ADR-sized and the records they produced are named in Q23; nothing is drafted here any more.

**Q24 to Q28 came later, out of building.** Q24 to Q27 came out of task 071, and were ruled by the Code Owner on 2026-09-29 on the independent review of PR #1016. They are numbered in the same sequence because they belong to the same decision record. Three of them close publish gaps this design did not foresee, and the fourth accepts a gap between two tasks rather than closing it. **Q28 came out of task 073** and was ruled on 2026-10-01: it settles what produces the no-JS 200 that Q9 and Q21 had already ruled, after that mechanism turned out not to be expressible in the way those rulings implied. They carry no recommendation, because each was put as a finding rather than as a set of options; Q28 was put with four alternatives and their costs, and the ruling names which were refused.

| #   | Question                                                                          | Recommended                                                    | Ruled 2026-09-29                                                                        |
| --- | --------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Q1  | Is repetition in scope, and where?                                                | Phase 4, after task 038                                        | **DIFFERS: into launch scope.** The cut-line moves.                                     |
| Q2  | One primitive with three presentations, or three mechanisms? **ADR**              | One                                                            | As recommended: one primitive, three presentations.                                     |
| Q3  | Is the table a presentation or a distinct question type? **ADR**                  | A presentation                                                 | As recommended: a presentation, not a question type.                                    |
| Q4  | Which count sources ship, and is `max` required on open-ended?                    | All three; `max` required on `open`                            | **DIFFERS by consequence of Q14:** all three, and `max` required on `fromAnswer` too.   |
| Q5  | What happens to a removed instance's answers?                                     | Excluded, never deleted; reuse I6                              | As recommended.                                                                         |
| Q6  | The instance label template and the ordinal.                                      | `{n}` is the live ordinal; the id is never a label             | As recommended.                                                                         |
| Q7  | How many new rule operators? **ADR**                                              | Two: `anyInstance` and `instanceCount`                         | **DIFFERS: three.** `everyInstance` ships, and is **false** over an empty group.        |
| Q8  | `FlowState`: parallel optional fields, or multi-version evaluation first? **ADR** | Parallel optional fields now                                   | As recommended; the tidy-up is the first job of multi-version evaluation.               |
| Q9  | The no-JS add and remove mechanism.                                               | Named submit buttons carrying `formnovalidate`                 | As recommended: `__qop`, `formnovalidate`, instance-qualified names.                    |
| Q10 | Table semantics: native `<table>` or `role="grid"`? **ADR**                       | Native `<table>`                                               | As recommended: a native `<table>`, never `role="grid"`.                                |
| Q11 | Focus and announcement after add and remove.                                      | APG destinations; no live region on the no-JS path             | As recommended, plus a fragment landing on the no-JS path.                              |
| Q12 | Which question types may be table columns?                                        | shortText, number, date, boolean, singleChoice                 | As recommended, and the stacked presentation is **one input per row**, all seven types. |
| Q13 | Nesting depth. **ADR**                                                            | One. A group may not contain a group                           | As recommended: depth one, refused at parse.                                            |
| Q14 | Instance ceiling per group and per session.                                       | 100 per group, 200 per session, both core constants            | **DIFFERS: no installation-wide ceiling. Per-form `max` only.**                         |
| Q15 | The separator in a qualified answer key.                                          | `/`                                                            | As recommended: `/`.                                                                    |
| Q16 | Roster storage: a new table, or inside `answers`? **ADR**                         | A new append-only table                                        | As recommended: `answer_group_instances`.                                               |
| Q17 | CSV export shape.                                                                 | Long, one extra file per group, zipped                         | **DIFFERS: both shapes.** Long is the default; wide indexed columns are an option.      |
| Q18 | How `reporting.responses.answers` represents a group.                             | One key per group id holding an ordered array                  | As recommended; `jsonb_object_agg` must stop collapsing duplicates.                     |
| Q19 | Does the redacted outbox payload carry instance counts?                           | No                                                             | As recommended: no ids, no roster, no counts.                                           |
| Q20 | Does the answer endpoint gain a batch form?                                       | Yes                                                            | As recommended, and **issue #968 is fixed in the same work**.                           |
| Q21 | The `qcms_step_ctx` cookie under N instances.                                     | Take `values` and `missingRequired` from the API; cap the rest | As recommended, with defined overflow behaviour.                                        |
| Q22 | How the ADR-28 cursor addresses a per-instance step page.                         | `(stepId, instanceId)`, in `visibleStepViews`                  | As recommended: the cursor indexes `visibleStepViews`.                                  |
| Q23 | Which ADRs are created and which are amended.                                     | Two new, nine amended or noted                                 | As recommended, **plus a new SEC-16**.                                                  |
| Q24 | A rule naming a `groupId` the form does not declare.                              | _(put as a finding)_                                           | **Refused at publish**, `DANGLING_GROUP_REF`.                                           |
| Q25 | May a whole-group operator sit inside another one's condition?                    | _(put as a finding)_                                           | **No**, refused at publish; the pairwise budget then bounds every rule.                 |
| Q26 | References that have no single value.                                             | _(put as a finding)_                                           | **Two refusals**, each naming what the author should do instead.                        |
| Q27 | The window between 071 and 073 where a group publishes but cannot be answered.    | _(put as a finding)_                                           | **Accepted**, no guard built; 073 closes it.                                            |

**Q1. Is repetition in scope, and where? Ruled: INTO LAUNCH SCOPE.** _Recommended: Phase 4, dispatched after task 038 and recorded in `docs/features/039-phase4-backlog.md` beside the file-upload question type._ The Code Owner ruled it into launch instead, and that **moves the launch cut-line** rather than fitting inside it, so the move is recorded at every place the cut-line or the launch scope is enumerated rather than only here: `docs/PROJECT_GOAL.md` section 5 lists repeating groups among what launch includes, `docs/IMPLEMENTATION_PLAN.md` carries the work as **stage 8c**, between admin authoring and distribution, and the ledger in `docs/features/README.md` carries 071 to 077 as launch-scope rows sequenced before task 038 rather than after it. It is **not** recorded in `039-phase4-backlog.md`, which is the Phase 4 itch ledger: putting launch scope there would make the one document whose job is to hold deferred work hold something that is not deferred. Section 12 re-sequences the tasks against their real dependencies, including issue #968 (Q20). _Consequence of the ruling:_ launch validation (038) now has a repeating-group walk in it, and the stage-8c work is on the critical path to the launch gate.

**Q2. One primitive with three presentations, or three mechanisms? (ADR-sized.) Ruled: one,** as recommended. A looping question is a group of one, a looping step is a presentation, a table is a presentation. _Recorded in:_ ADR-42. _Consequence:_ a decision about instance ids or the no-JS mechanism is taken once rather than three times.

**Q3. Is the table a presentation, or a distinct question type? (ADR-sized.) Ruled: a presentation,** as recommended. Section 2.3 has the full cost of the alternative: a distinct type adds an `AnswerValue` member, breaks per-cell "empty is absence", per-cell validation and per-cell retraction, breaks the CSV and reporting grain, and lights up every exhaustive switch and `Record<QuestionType, ...>` table over the question type plus the eight registration sites of `scripts/component-registration.test.ts`. _Recorded in:_ ADR-42, which states it as the "why not a table question type" clause. _Consequence:_ the vocabulary cost is paid once in the admin's labelling; the alternative's cost would be paid forever in every layer below it.

**Q4. Which count sources ship, and is `max` required? Ruled: all three ship, and `max` is REQUIRED on both `fromAnswer` and `open`.** _Recommended: all three, with `max` required on `open` alone._ The difference is a consequence of the Q14 ruling rather than a separate call: with no installation-wide ceiling, a group's own `max` is the only bound that exists, so a `fromAnswer` group without one lets the respondent's answer to the count question set the size of the loop. Publish refuses a missing `max` on either source with `REPEAT_MAX_MISSING`. **A fixed count is its own bound** and carries no `max`. _Consequence:_ a required `max` is one more field an author sets, and after Q14 it is the only thing standing between a form and section 8's first abuse case.

**Q5. What happens to a removed instance's answers? Ruled: excluded exactly as a hidden question's answers are excluded (I6), never deleted,** as recommended. _Consequence:_ a respondent who removes passenger 3 and adds one back gets a **new** instance with no answers, while the removed one's answers stay in the ledger and in no export. A respondent who lowers a count and raises it again gets the **same** instance with its answers intact, because nothing was removed.

**Q6. The instance label template and the ordinal. Ruled: `instanceLabel` with a single `{n}` placeholder, `{n}` being the one-based live ordinal recomputed after a removal; the `ins_` id is never a label a respondent reads.** As recommended, with one correction to the wording this document used. The earlier phrasing was "the id is never shown to a respondent", and that is false: the id is in every field `name`, every DOM `id`, every error-summary anchor, the Remove button's `value` and the fragment the no-JS re-render focuses. The true claim is narrower and is the one that matters: **no heading, legend, label, error message or button caption carries it**, so a respondent never has to read or understand it. Section 2.6 carries the same correction. _Consequence:_ the ordinal is presentation, so an export's `instance_ordinal` column is the ordinal **at submission** and the `instance_id` is what joins.

**Q7. How many new rule operators? (ADR-sized, ADR-03.) Ruled: THREE, `anyInstance`, `instanceCount` and `everyInstance`, and `everyInstance` over an empty group is FALSE.** _Recommended: two, cutting `everyInstance` because its vacuous truth over an empty group is a trap and because it is expressible as `not(anyInstance(not c))`._ The ruling takes the operator and rules out the trap with it: the empty case is defined as false, **deliberately not vacuous truth**, so `everyInstance` is **not** equivalent to `not(anyInstance(not c))` when the group is empty. That non-equivalence is the part that has to be written down everywhere it would otherwise be assumed away, and it is:

- **ADR-03's amendment** states the operator set and the empty-group reading as part of the decision.
- **The evaluator semantics** (section 3.4) make the empty roster a base case that short-circuits to false, never a fold whose identity is true.
- **The golden scenarios** append the empty-group case beside all-match and one-mismatch, so the reading is pinned by a committed expectation rather than by prose.
- **The rule sentence** reads "every passenger ... (and there is at least one passenger)", because an author reading "every passenger holds a passport" would otherwise supply the classical reading themselves. The sentence is false until a passenger exists, and it says so.
- **The test bench** evaluates against zero instances, so an author can see the false result rather than read about it.

_Consequence:_ each operator costs an edit to `visibility-rule.test.ts`'s hand-spelled list, which goes to sixteen, a matching edit to `apps/admin/lib/forms/condition.ts`, a structured editor, a sentence in `rule-sentence.ts`, a golden scenario, and **four** functions rather than the one an earlier draft named. It is not `checkValue`, which switches on `question.type` for the `equals`, `notEquals` and `in` value checks: the branches are in **`checkCondition`** and **`collectReferences`** in `packages/core/src/rule-graph.ts` and in **`evalCondition`** in `packages/core/src/evaluate-rules.ts`. `collectReferences` is the one easiest to miss and the one that matters most: its default branch reads `condition.questionId`, which none of the three group nodes carries, and it is what `analyzeRuleGraph` and the cycle graph read, so forward-only rule 2 does not apply to a group operator at all until that function knows about them.

**Q8. `FlowState`: parallel optional fields, or multi-version evaluation first? (ADR-sized, ADR-16.) Ruled: parallel optional fields now,** as recommended, **and the tidy-up is recorded as the first job of multi-version evaluation.** Section 3.5 has the table. _Consequence:_ this is the one place the design is ugly, `FlowState` carries two arrays that mean nearly the same thing, and the record says why rather than hiding it. ADR-16's amendment carries the tidy-up as the first thing multi-version evaluation buys, so the debt has a named creditor.

**Q9. The no-JS add and remove mechanism. Ruled: named `__qop` submit buttons carrying `formnovalidate`, with instance-qualified field names and no repeated names. A second ruling of the same date settles what the post does: an Add or Remove applies ONLY the roster operation and commits NO answers.** Section 4.2 is written to both. The second ruling is what keeps the 2026-09-13 ruling on browser validation whole: with no answer write on that post, an emptied required field is neither stored nor retracted, so **`docs/portal-constraints.md`'s "a required question cannot be CLEARED without scripting" bullet is unchanged** and 073 asserts it rather than amending it. _Consequence:_ `decodeStepForm` gains one reserved prefix, the typed values ride the POST body into a 200 re-render rather than a 303 (section 4.2, Q21 and Q28), the roster operation carries a one-time token so a replay is a no-op, and `docs/portal-constraints.md`'s exception list stays empty. The 200 is produced by a Next Server Action rather than by a branch in the step route (Q28), so what the route gains is nothing and what the page gains is an action.

**Q10. Table semantics: native `<table>` or `role="grid"`? (ADR-sized, portal.) Ruled: a native `<table>`, never `role="grid"`.** As recommended. Section 4.5 has the four reasons and the cost. _Consequence:_ the documented cost is one tab stop per cell, so the count is `columns x max`, and after the Q14 ruling the group's own `max` is the whole of the mitigation.

**Q11. Focus and announcement after add and remove. Ruled: the APG focus destinations, a status region on the JS path, and a fragment landing on the no-JS path.** As recommended, with the destination list stated in full: after add, the new instance's heading; after remove, the heading of the instance that took its place, then the **previous** instance's heading when the removed one was last, then the **Add button** when the removed one was the only instance; a `role="status"` region on the scripted path only. Section 4.3 has the three destinations in order and names which of them the APG covers. _Consequence:_ no source covers focus after a POST-redirect-GET, so the landing on that path is a decision this plan takes rather than a citation it makes, and task 030's manual pass is where it is tested. Q28 settles what that landing IS: the `autofocus` attribute, because the ruled response is a 200 to a POST and such a response carries no fragment.

**Q12. Which question types may be table columns, and how does the stacked presentation lay a card out? Ruled in two halves.** **Stacked:** one input per row, a single column with no side-by-side fields at any width, and **every** question type allowed. **Table:** five cell types, `shortText`, `number`, `date`, `boolean` and `singleChoice`, with `longText` and `multiChoice` refused at publish and the admin pointing at the stacked presentation. Sections 4.4 and 4.5. _Consequence:_ the two presentations are deliberately asymmetric, and the asymmetry is what makes the refusal survivable: an author refused a column type has a presentation that takes it.

**Q13. Nesting depth. (ADR-sized.) Ruled: one. A repeating group may not contain a repeating group, refused at parse.** As recommended. _Consequence:_ lifting the cap later is a real change to addressing and export, not a constant, so the record says no deliberately rather than leaving the cap to read as an oversight.

**Q14. Instance ceiling per group and per session. Ruled: NO INSTALLATION-WIDE CEILING. Per-form limits only.** _Recommended: a group's `max` capped at 100 and a session capped at 200 live instances, both core constants, both publish-validated._ The ruling removes both. Bounds come **solely from each group's author-set `max`**, which Q4 as amended makes required on every source that is not `fixed`, enforced by publish and by the API. Section 8 is rewritten to it, and states plainly what that leaves: with no global ceiling, the payload, the tab-stop count (Q10), the POST size and the evaluator cost are bounded **only per form**. The request-size and rate limits that already exist are kept as they are; no global cap is invented in their place, and the roster operation's own rate limit bounds how fast a bounded operation may be repeated rather than how large it may become. _Consequence:_ an author's `max` is a security-relevant field, and form review rather than a core constant is where it is checked. SEC-16 records both the rule and the absence, because a reader needs to be able to cite what is deliberately not controlled.

**Q15. The separator in a qualified answer key. Ruled: `/`, as in `ins_7k2/q_passport`.** As recommended. _Consequence:_ it is baked into every stored `answers.instance_id` join, every field name, every DOM id and every error-summary anchor, and it needs `CSS.escape` in a selector, which the shared jsdom setup already polyfills.

**Q16. Roster storage: a new table, or inside `answers`? (ADR-sized.) Ruled: a new append-only table, `answer_group_instances`.** As recommended. Section 5.2. _Consequence:_ the new table gives removal an explicit audit row, which the synthetic-answer alternative could only express as a value diff, and it costs two triggers, a CHECK, an index, a foreign key, an `EXPECTED_TABLES` entry, an erasure-path entry, and in ADR-40 four more per-environment guards, an eighth foreign key and an eighth data-plane table, which reconciled with the #995 rulings is seventeen guards, eight keys and twenty-five objects per environment.

**Q17. CSV export shape. Ruled: BOTH shapes.** _Recommended: the long shape alone, one extra file per group, zipped._ The ruling keeps long as the **default** and adds indexed wide columns as an **export option**. Section 5.5 has both, and carries the documentation the wide option requires: **a wide export's header depends on each version's `max` and changes when `max` changes**, which is why the export route's existing `version` requirement is the thing that makes a wide export automatable at all. _Consequence:_ a consumer who automates a wide export pins the version they bound to, and the export screen says so; a consumer who wants a stable header takes the long shape, which is what it is the default for.

**Q18. How `reporting.responses.answers` represents a group. Ruled: a nested array per group,** as recommended: `questionId -> value` for everything outside a group, and one key per group id holding an ordered array of `{instance_id, questionId: value, ...}`. **`jsonb_object_agg` must stop collapsing duplicates**, which it does today with no error and no warning. _Consequence:_ a form with no group produces a byte-identical `answers` object, so the change is additive in fact and not only in principle.

**Q19. Does the redacted outbox payload carry instance counts? Ruled: no. The redacted payload carries no instance ids, no roster and no counts.** As recommended. _Consequence:_ the CHECK's guarantee stays readable as "after redaction there is no respondent-derived value of any kind", and SEC-16 records it so the next person to add a field to that payload reads the rule rather than the absence.

**Q20. Does the answer endpoint gain a batch form? Ruled: yes, the no-JS step route uses it, and issue #968 is fixed in the same work.** As recommended, with the dependency promoted from advice to a deliverable: #968 records that the required-answer sweep runs before the session lock, so a concurrent retraction can leave the ledger and the submission out of step, and a repeat multiplies that window by the number of fields a step posts. **Closing #968 is part of task 073's deliverables and exit criteria**, not a prerequisite that might land elsewhere.

**The batch is used by Continue, not by Add or Remove.** The 2026-09-29 ruling on the no-JS operation commits no answers on an `__qop` post, so the batch endpoint carries a Continue's answers and nothing else, and the roster operation is its own call. The earlier claim that the batch "makes the roster operation and the answers one transaction" therefore no longer holds and is withdrawn: the two are separate posts by ruling, and each is atomic on its own.

_Consequence:_ the respondent-facing API carries no stability promise (ARCHITECTURE section 5.1), so the batch is an internal contract change and not a versioned one. **It also has a rate-limit consequence that SEC-16 must state rather than inherit** (section 8.2): `answersPerSessionLimiter` keys per **request**, so a batch of `max x m` answers would spend one unit of a per-session allowance that was written for one answer, multiplying the effective allowance by the batch size. The batch is therefore limited **per entry**, not per request.

**Q21. The `qcms_step_ctx` cookie under N instances. Ruled: the re-render takes `values` and `missingRequired` from the API step projection, and the cookie keeps only the 422 constraint errors, capped, with defined overflow behaviour.** As recommended, and section 4.2 works out two things the ruling's wording leaves to the design.

**A refused value needs a carrier, and the projection is not one.** The API's step projection holds accepted answers only, so a value refused with a 422 is in neither the projection nor a cookie that keeps "only the errors", and the cell would come back **blank beside a message about what the respondent typed**: the 3.3.7 Redundant Entry failure this document names in section 4.3, reached from the other side. So the capped cookie record is **`{error, constraint, value}` per refused field**, and the **cap is stated in fields rather than bytes** so a reviewer can check it. Only refused fields need a record, so the set is bounded by what the API rejected rather than by the step's size.

**The Add and Remove path has a different carrier, because nothing was accepted there at all.** Every typed value has to survive, not a refused subset, and the whole step at nine instances is exactly what does not fit in 4 KB. The carrier is the **POST body** (confirmed by the Code Owner, 2026-09-29): the `__qop` request re-renders in its own 200 response instead of redirecting, and the roster operation carries a one-time token so that a reload replays nothing. **What produces that 200 is a Next Server Action** (Q28, 2026-10-01), which is the only mechanism in this framework that answers a POST with the page it was posted from. Section 4.2 records that as a deliberate departure from the 303, with the cookie-carriage alternative and why it was refused.

_Consequence:_ the cookie stays 15 seconds and httpOnly; what changes is how much of the re-render it is responsible for, what each record holds, and what it does when the cap is reached, which is written down rather than discovered.

**Q22. How the ADR-28 cursor addresses a per-instance step page. Ruled: the cursor indexes `visibleStepViews`, a list of `(stepId, instanceId | null)`.** As recommended, and it stays a 0-based index into a list the server computes rather than a compound cursor on the wire.

**The reason for refusing a compound cursor is restated, because the one this document gave does not survive finding 13.** The earlier reason was "it would put a session-scoped id in a URL a respondent can see and edit", and that is already true of the fragment the no-JS add lands on. The reason that survives is about what a forged value can reach: **a cursor is an index into a list the server computed for this session on this request**, so an index out of range is refused by arithmetic and an index in range names a view the server had already decided was visible. A compound cursor would instead accept an instance id as input and have to prove it belongs to this session, to this group and to the live roster, which is three checks where the index needs none. _Consequence:_ ADR-28's rule is unchanged, and `progress: {stepIndex, totalVisibleSteps}` counts views, so a three-passenger `perInstanceStep` group is three views and the progress indicator says so.

**Q23. Which records are created and which are amended. Ruled: two new ADRs, nine amendments, and a new SEC number.** _Recommended: two new and nine touched, with the security half left as the Code Owner's call between a new SEC number and a paragraph in an existing one._ The ruling takes the new number. The record is:

- **ADR-42 (core), "Repetition is a form-level group"** and **ADR-43 (portal), "Repeat rendering and the no-JS roster operation"**, both indexed in `docs/adr/README.md`.
- **Amendment notes on ADR-01** (the compiler emits a template the renderer expands), **ADR-03** (three operators, with `everyInstance` false over an empty group), **ADR-14** (the roster reaches the renderer without widening `StepResolverContext`), **ADR-16** (the per-instance pass within `semanticsVersion` 1, and the `FlowState` tidy-up as multi-version evaluation's first job), **ADR-18** (a new `a2uiSpecVersion` and a new golden generation), **ADR-28** (the cursor indexes views), **ADR-31** (add and remove commit immediately; no control's row changes), **ADR-33** (a retraction is per instance) and **ADR-40** (an eighth data-plane table, four more guards and an eighth foreign key per environment, reconciled with the #995 rulings at seventeen guards, eight keys and twenty-five objects).
- **SEC-16, "repeating-group bounds"**, in `docs/SECURITY_DESIGN.md`: the per-form `max` rule, the absence of a global ceiling, the `ins_` id prefix, and the abuse bounds.

_Consequence:_ each record carries the status "decided; not built", naming its owning task, following the precedent PR #997 set for ADR-40, ADR-41 and SEC-14.

**Q24. A rule naming a `groupId` the form does not declare. Ruled: REFUSED AT PUBLISH, `DANGLING_GROUP_REF`** (Code Owner, 2026-09-29). Nothing refused it, so such a rule published cleanly and could never fire: `anyInstance` and `everyInstance` over an unknown group are false forever and `instanceCount` reads zero. The author sees a form that validates and a question that never appears; a respondent sees a question that is always hidden, or always shown when the rule is a negation. It is the group-shaped sibling of `DANGLING_QUESTION_REF` and is reported beside it from the same publish check. _Consequence:_ a `groupId` is now resolved at publish exactly as a `questionId` and a `stepId` are, so all three id kinds a rule can name are refused when they do not resolve.

**Q25. May a whole-group operator sit inside another one's condition? Ruled: NO, refused at publish** (Code Owner, 2026-09-29). The condition tree is recursive, so `anyInstance(G, anyInstance(H, c))` parsed, and its cost is `max_G x max_H` **whatever the rule targets**: the outer walk runs once per live instance of G and each of those walks the whole of H. The evaluation budget charges a rule's **target** group against each group it reads, so a nested pair whose target sat outside every group was charged nothing at all. Two groups at `max: 5000` under one such rule published and cost twenty-five million leaf evaluations on every answer write, every step read and every submit, with the respondent setting the live counts. That is precisely the shape section 3.4's budget exists to refuse.

The refusal covers **every** nesting: reached through `and`, `or` and `not`, and the same group nested in itself (`anyInstance(G, everyInstance(G, c))`), which is quadratic in one group's own maximum. `instanceCount` is refused inside another operator too, although its own cost is constant, because the rule an author has to remember is "a whole-group operator reads a whole group, and a rule reads each group it names once" rather than a cost calculation. The alternative was to charge the product along the nesting chain, which keeps more expressive power and makes the refusal's path a chain rather than a pair; it was refused because neither sample use case wants a nested quantifier, and a bound nobody can predict from reading their own rule is a bound authors trip over. _Consequence:_ section 3.4's "it is per rule" bullet is true rather than approximately true, and SEC-16 says why: with nesting refused, a rule's whole-group reads **add** where they used to multiply.

**Q26. References that have no single value. Ruled: TWO REFUSALS, each naming what to do instead** (Code Owner, 2026-09-29). A question inside a group has one answer per instance, so a reference to it means something only where an instance is in scope. An author who writes one where none is has written something the evaluator resolves to nothing at all, for every respondent, forever.

- **A bare in-group reference from a rule that is not evaluated inside that group** is refused with `RULE_READS_GROUP_WITHOUT_OPERATOR`, and the message says to wrap the condition in `anyInstance` or `everyInstance` over that group. Two ways put an instance in scope and only two: the rule's own `show` targets sit inside the group, which makes the whole rule per-instance, or the reference sits inside a whole-group operator over it. **A rule targeting inside group H that reads a member of a different group G is the same defect and carries the same code**, which section 3.4 already implies by giving a reference a per-instance reading only "to a question that is also inside G".
- **A `fromAnswer` count source whose question sits inside a group** is refused with `REPEAT_COUNT_INSIDE_GROUP`, and the message says to move the count question out of every group. Its answer is per instance, so there is no single count for the group it sizes to read. A count question inside the group it sizes is additionally backward and carries `REPEAT_COUNT_BACKWARD_REF` as well; both are true and both are reported.

_Consequence:_ the per-instance case is untouched, and it is the case that carries the airline example: a rule inside the passenger group reading a passenger's date of birth needs no operator and gains none.

**Q27. The window between 071 and 073. Ruled: ACCEPTED, and no guard is built** (Code Owner, 2026-09-29). Task 071 lets a form containing a repeating group publish through the API, and until 073 nothing serves it: the compiler emits no node for the group and the serving path passes no roster, so a respondent is never asked the group's questions and a group whose `min` is 1 or more can never be submitted. The Code Owner accepts the window rather than building a guard that would be deleted three tasks later: nothing is deployed, the admin cannot author a group until 074, and the only way in is a hand-written draft posted to the authoring API. _Consequence:_ `docs/features/073-repeat-rendering.md` records that it closes the window, so the gap has a named closer rather than being remembered.

## 11. Acceptance cases

Numbered and testable. Each names the layer it is proved at, per ADR-23. The list is rewritten to the rulings of 2026-09-29, so the cases that proved the recommended installation-wide ceiling are gone and cases proving the ruled behaviour are in their place.

**Every case is owned by exactly one task**, and each task's work order under `docs/features/` cites the numbers it owns. The map is:

| Task    | Cases owned                       |
| ------- | --------------------------------- |
| **071** | 1, 2, 3, 6 to 21, 63 to 66        |
| **072** | 22 to 26                          |
| **073** | 4, 5, 27 to 38, 54 to 57          |
| **074** | 58 to 61                          |
| **075** | 46 to 53                          |
| **076** | none; its exit criterion is prose |
| **077** | 39 to 45, and 62                  |

A case appearing under two tasks would make it nobody's, which is why the map is here rather than inferred from seven exit-criteria lists. Task 076 is the one task with no numbered case: its behaviour is the cursor walking views, which section 12 states as a prose criterion because it is an assertion about a sequence rather than about a value.

**Additivity**

1. **Every** committed golden evaluator scenario passes with no `expected` block edited, against the repetition-aware evaluator, and the count at the head the task branches from is asserted rather than hard-coded here (51 at `c1988256`). _(unit)_
2. The insurance submission's committed `contentHash` is unchanged. _(unit)_
3. A form with no repeating group produces a `FlowState` with no new key present, asserted by deep equality against the pre-change shape. _(unit)_
4. A snapshot **published before the schema move** parses, serves, accepts answers and submits unchanged. The case is worded that way deliberately: no stored column holds a schema version, because the API stamps `SNAPSHOT_SCHEMA_VERSION` from the constant at read time, so "a snapshot stamped `schemaVersion: 1`" is not a state a fixture can be in. **The wording is confirmed as it stands** (Code Owner, 2026-09-29); if a later task chooses to store the stamp, this case becomes the assertion over the stored value instead. _(integration)_
5. The seven existing compiler golden documents are byte-identical in the new generation. _(unit)_

**Kernel**

6. A `questionId` pinned both inside a group and outside it is refused at parse with `DUPLICATE_QUESTION_IN_FORM`. _(unit)_
7. A group inside a group is refused at parse. _(unit)_
8. A `fromAnswer` count whose question appears after the group is refused at publish with `REPEAT_COUNT_BACKWARD_REF`; one that appears before it publishes. _(unit)_
9. **`max` is required on both bounded count sources.** An `open` group with no `max` is refused at publish with `REPEAT_MAX_MISSING`, and so is a `fromAnswer` group with no `max`; a `fixed` group publishes carrying no `max` at all, because its count is its own bound. _(unit)_
10. **There is no installation-wide ceiling, asserted as a positive case.** A group declaring `max: 5000` publishes without error, and no core constant is consulted, so the absence of the ceiling is pinned by a test rather than by the absence of one. _(unit)_
11. A rule targeting a question inside a group evaluates once per live instance, and a condition reading a question in the same group resolves to that instance's answer and to no other. _(unit, golden)_
12. `anyInstance` is true when one of three instances matches and false when none does; `instanceCount gte 5` is false at four instances and true at five. _(unit, golden)_
13. **`everyInstance` is true when all three instances match, false when one does not, and FALSE over an empty group**; the same scenario asserts that `not(anyInstance(not c))` is **true** over that empty group, so the non-equivalence the Q7 ruling creates is pinned rather than assumed. _(unit, golden)_
14. A rule reading a question inside a group and targeting a question outside it is refused at publish unless its target follows the group's whole span. _(unit)_
15. **One rule, one scope.** A rule whose `show` list holds one question inside a group and one outside it, or one inside each of two groups, is refused at publish with `RULE_TARGETS_SPAN_SCOPES` naming both scopes; the same list split across two rules publishes. _(unit)_
16. **The cross-group cost budget.** A rule targeting inside group H whose condition applies `anyInstance`, `everyInstance` or `instanceCount` over group G is refused at publish with `REPEAT_EVALUATION_BUDGET_EXCEEDED` when `max_H x max_G` exceeds `REPEAT_EVALUATION_BUDGET`, and publishes when it does not. The same case asserts that **two groups above the budget with no cross-group rule still publish**, so the constant is shown to bound a rule shape and not an instance count. _(unit)_
17. A removed instance's answers are excluded from every later condition, from `missingRequired`, and from the locked submission, while remaining in the ledger. _(unit, golden, integration)_
18. Lowering a `fromAnswer` count hides the trailing instance; raising it again restores the same instance id with its answers intact. _(integration)_
19. A required question inside a group with three live instances and two answered produces exactly one `MISSING_REQUIRED` entry naming the third instance. _(unit)_
20. A group below `min` or above `max` at submit is refused with `REPEAT_COUNT_OUT_OF_RANGE`. _(unit)_
21. A cell posted as `""` or `[]` is refused with `EMPTY_ANSWER_NOT_ALLOWED`, per cell, and `null` retracts that cell alone. _(integration)_

**Storage**

22. Two answers for one question in two instances both persist and both read back; `latestAnswers` returns one value per `(question, instance)`. _(integration, real Postgres)_
23. An UPDATE and a DELETE on `answers` and on `answer_group_instances` are both rejected by trigger, outside the erasure door. _(integration, real Postgres)_
24. `eraseSession` leaves no row in `answers`, `submissions` or `answer_group_instances` for that session, asserted by count, and writes one tombstone. _(integration, real Postgres)_
25. `purgeExpired` reaches the roster table. _(integration, real Postgres)_
26. `migrations.test.ts`'s `EXPECTED_TABLES` names the new table, and the drizzle chain and its snapshots link. _(unit)_

**Serving, both paths**

27. With scripting on: answering three passengers, adding a fourth, removing the second, and submitting produces a locked set of three instances with the right answers against the right ids. _(browser)_
28. With `javaScriptEnabled: false`: the same walk completes, including add and remove, and reaches the receipt. _(browser)_
29. With scripting off, pressing **Add passenger** on a step with a blank required field adds the instance rather than being refused by the browser, and the step comes back with every typed value still in place. The same case asserts the two halves of the 2026-09-29 ruling on that post: **no answer row is written** by it, and a previously answered required field emptied on that post is **not retracted**, so the ledger holds what it held before. Reloading the response applies the roster operation **once**, which the one-time operation token is what makes true. _(browser, with a ledger assertion at the integration layer)_
30. With scripting off, only the pressed button's name and value reach the server: a POST carries exactly one `__qop` entry, or none. _(unit on the decoder, browser on the wire)_
31. An error summary entry reads "Passenger 2: passport number is required" and its anchor moves focus to that instance's passport field. _(browser)_
32. After adding an instance with scripting on, focus is on the new instance's heading. After removing one, focus is on the heading of the instance that took its place; on the **previous** instance's heading when the removed one was last; and on the **Add button** when the removed one was the only instance, which the case exercises on a group whose `min` is 0. _(browser)_
33. Adding an instance with scripting on announces through a `role="status"` region as a whole sentence. _(browser)_
34. A ten-instance step carries exactly one honeypot decoy. _(unit on the compiled document, browser on the DOM)_
35. A nine-instance step's re-render after a validation failure returns every answer the API accepted **and every value it refused, shown in its own field beside its own message**, with no cookie overflow; an overflowing refused set keeps the first N fields, drops the rest and says some messages could not be carried, and never loses an accepted answer. _(browser)_
36. The whole-step POST for a nine-instance step makes one batched API call, not fifty-four. _(integration)_

**Stacked presentation**

37. **One input per row.** Inside an instance card no two controls share a horizontal band at any viewport project: every control's box starts at the card's content edge, asserted at 390px and at the widest project the config runs. _(browser)_
38. A group whose members include `longText` and `multiChoice` publishes and renders in the stacked presentation, both types answerable on both paths. _(unit, browser)_

**Table presentation**

39. The table renders as a native `<table>` with a caption, `<th scope="col">` per column and `<th scope="row">` per row, and no `role="grid"` anywhere. _(unit, jsdom)_
40. Every cell input has an accessible name naming its row and its column, asserted from the accessibility tree and not from the DOM. _(unit, jsdom)_
41. At 390px the table reflows to one card per row, every input keeps the same accessible name, and the page has no horizontal scroll. _(browser, mobile project)_
42. A column type outside the allowed set is refused at publish with `TABLE_COLUMN_TYPE_NOT_ALLOWED`, and the refusal names the stacked presentation. _(unit)_
43. The column total is not an input, is not posted and appears in no locked answer set. _(browser, integration)_
44. A focused cell in the first row is not obscured by a pinned header. _(browser)_
45. axe reports no violation on a filled table at every viewport project. _(browser)_

**Downstream**

46. A CSV export of a form with one group, in the default long shape, produces the unchanged wide file plus one group file, joinable on `session_id`, with the formula-injection guard applied in both. _(integration)_
47. **The wide shape is an option and its header follows the version's `max`.** The same form and version requested in the wide shape returns one flat file carrying `q_passport__1` through `q_passport__<max>`, with the columns beyond a session's live count empty and the guard applied; the same request against a later version whose `max` is higher returns a header with more columns, asserted as the documented consequence rather than as a defect. _(integration)_
48. A CSV export of a form with no group is byte-identical to today's, in either shape. _(golden)_
49. `reporting.answers_flat` returns one row per `(session, question, instance)` and loses nothing; the pre-change query against a non-repeating form returns identical rows. _(integration, real Postgres)_
50. `reporting.responses.answers` for a non-repeating form is byte-identical to today's, and for a repeating one carries the group's ordered array with no duplicate collapsed. _(integration, real Postgres)_
51. The `response.submitted` payload carries every instance inside its `answers` member and nowhere else, asserted by walking the payload for respondent content outside that key. _(integration)_
52. After redaction, the payload holds no `answers` key, no instance id and no count, and the CHECK holds. _(integration, real Postgres)_
53. No exported span or log record carries an answer value or an instance label; `ins_` ids are permitted. _(integration, the existing in-test OTLP receiver)_

**Abuse**

54. An add that would exceed the group's `max` is refused by the API. The same test adds to `max` in **each of two groups in one session** and succeeds, because no per-session total ceiling exists to refuse it (Q14). _(integration)_
55. A step POST above the request-size limits already in force is refused with the standard error envelope. _(integration)_
56. The roster operation is rate limited per session and per IP, separately from the answer write. _(integration)_
57. **The batch endpoint is limited per answer, not per request.** A single batch carrying N answers spends N units of the per-session answer allowance, asserted by posting one batch that exceeds the allowance and getting a 429, and by posting two batches whose entry counts sum to the allowance and having both accepted. _(integration)_

**Authoring**

58. An author can define a group, choose each count source, set `min` and `max`, write the label template and switch presentation, and the draft round-trips through save and reload; a `fromAnswer` or `open` group with `max` left empty cannot be published and says why. _(browser, admin project)_
59. The rules editor shows "evaluated per passenger" on a rule whose target is inside a group, and offers structured editors for all three new operators. _(browser)_
60. The test bench evaluates a rule against hypothetical instances and reports a per-instance result, **including against zero instances**, where an `everyInstance` rule reports no match. _(browser)_
61. The preview expands a group through the same renderer the portal uses, and its DOM for a repeated step matches the portal's structurally. _(browser)_
62. The library picker offers only the allowed cell types when adding a column to a table-presented group, says why, and names the stacked presentation as the alternative. _(browser)_

**Publish gaps closed after the fact (Q24 to Q26, ruled 2026-09-29)**

63. A rule whose `anyInstance`, `everyInstance` or `instanceCount` names a `groupId` the form does not declare is refused at publish with `DANGLING_GROUP_REF`, for each of the three operators. _(unit)_
64. **A whole-group operator may not sit inside another's condition.** The two-group nest, the same group nested in itself, and nesting reached through `and`, `or` and `not` are each refused with `REPEAT_OPERATOR_NESTING_NOT_ALLOWED`; a three-group shape whose every **pair** is within the evaluation budget is refused too, because its whole cost is the product of all three. Two whole-group reads that are **siblings** rather than nested still publish, which is what makes the pairwise budget a bound on a rule. _(unit)_
65. **A reference with no single value is refused, and the refusal says what to do.** A bare reference to an in-group question from a rule outside every group is refused with `RULE_READS_GROUP_WITHOUT_OPERATOR` whose message names `anyInstance` and `everyInstance`; so is the same reference from a rule targeting inside a **different** group. A rule inside group G reading G's own member still publishes, and so does the wrapped form the message asks for. _(unit)_
66. A `fromAnswer` count source whose question sits inside a repeating group is refused with `REPEAT_COUNT_INSIDE_GROUP`, and one whose question the form does not pin at all is refused with `DANGLING_QUESTION_REF`. _(unit)_

**Q28. What produces the no-JS Add and Remove's 200, and where does focus land on it? Ruled: a NEXT SERVER ACTION, with the portal's `Referrer-Policy` widened to `same-origin`, the belt run inside the action, and the landing by `autofocus` rather than by a fragment** (Code Owner, 2026-10-01). This question was not foreseen: Q9 and Q21 ruled the carrier and the response code and both stand, and what they left open was the mechanism, which turned out not to exist in the shape they implied. Task 073 found it while building and asked rather than choosing.

**What was unbuildable.** Section 4.2's "the `__qop` request re-renders the step in its own 200 response" reads as a branch in the step's own route handler. In Next's App Router it cannot be: a **page** answers GET and HEAD, so a POST to it is a 405; a **route handler** can return any `Response` but cannot render the page, because Next injects the stylesheet and script tags at render time and a hand-rendered document comes back unstyled and scriptless; a segment may hold a `page` or a `route` and not both, so no arrangement of files puts a POST handler and the step page on one path; and middleware can rewrite a request but not change its method.

**What was ruled.** A **Server Action** on the step form. It runs against the page that declares it, and with scripting disabled Next runs it and then renders that page's HTML **in the same 200 response**, which is exactly the shape Q21's carrier needs. `useActionState` carries the action's return value into that render, which React does server-side before any hydration. The action goes on the FORM and Continue carries a plain URL `formaction`, so React is nowhere near the `__qop` buttons: those stay ordinary `<button name value formnovalidate>` markup, which is what Q9 ruled, and only the pressed button contributes its pair by HTML's own rule.

**Three things ride with it, and each is part of the ruling.**

1. **The portal's `Referrer-Policy` becomes `same-origin`**, and the admin and the API keep `no-referrer`. Next's action handler compares a request's `Origin` to the `Host` and refuses `null`, and under `no-referrer` a navigation POST serializes its `Origin` as the literal `null` (Fetch), so the operation died in the framework before any QCMS code ran. `same-origin` sends nothing cross-origin, so Turnstile and outbound links are unchanged; what a same-origin request carries is the submitting page's own URL, which is already in that request's own path. A secure-link token cannot become a referrer, because `/l/{token}` is a GET that answers 303 without rendering. SEC-9 as amended carries the normative statement.
2. **The action runs SEC-9's belt itself** (recorded as ruling R-B2 of the same date). Next's own check is not a substitute: it **admits a request carrying no `Origin` at all** after only a warning, compares the host while **ignoring the scheme**, and **never reads `Sec-Fetch-Site`**. So the belted set grew by an entry point that is not a route handler, and both origin gates enumerate `"use server"` modules beside route files.
3. **Focus lands by `autofocus`, never by a fragment.** A 200 answering a POST leaves the browser on the POST's own URL, which carries no fragment, so section 4.3's "reached by a fragment on the re-rendered page" could not happen. `autofocus` applies to every element rather than only to form controls, and a negative `tabindex` makes the instance heading a focusable area. **The two are mutually exclusive**: the flush algorithm skips `autofocus` when the document has a fragment target. Verified in Chromium and Firefox with scripting disabled, including on a 200 answering a POST; WebKit was not exercised, because its host libraries are not installed on the build host.

**Four alternatives were weighed and refused**, and they are recorded so the ruling is readable as a choice rather than as the only idea anyone had.

- **A server-side self-fetch**: the route handler applies the operation, fetches its own flow page over loopback with the typed values on a request header, and returns that HTML. Refused: `QCMS_PORTAL_BASE_URL` is the public origin, so in the default Compose shape a fetch to it reaches nothing inside the container and with the Caddy overlay it leaves and re-enters through the proxy; it needs a loopback variable the deployment does not have; the values are bounded by Node's 16 KB header limit; and the CSP nonce chain breaks, because the inner render carries the inner request's nonce while the outer response header carries the outer one, which blocks every script for a respondent who submitted before hydration.
- **The capped `qcms_step_ctx` cookie**: expressible today, and it is the carrier section 4.2 refused for size. At nine `longText` instances it drops answers, which is the one outcome this design refuses, and sharding across cookies raises the bound to the request-header limit and no further.
- **A session-row draft with a 303**: `sessions.step_draft jsonb`, written in the same transaction as the roster operation and returned in the step projection, with `Location: /s/{id}#ins_7k2`. It satisfies both questions, restores post-redirect-get and removes the browser's resubmission prompt, and it was the recommendation the memo put. Refused in favour of keeping the 200 the earlier ruling settled: it would put respondent content on the session row for the first time, make the erasure scrub set non-empty, and reopen Q21's carrier decision three days after it was taken.
- **`serverActions.allowedOrigins: ['null']`**, which would have admitted the action under the existing `no-referrer`. Refused outright: it admits every null-origin POST, including a cross-site one from any page that declares `no-referrer` on itself, because Next reads no Fetch Metadata.

_Consequence:_ one mechanism in the portal is a framework entry point rather than a QCMS route, so the two origin gates had to learn about actions and SEC-9 had to say which policy each app serves and why. Next also recalculates action ids between builds, so a page held across a deploy posts a stale id: the flow segment carries an error boundary that says so and offers the current step, and an Add commits no answer, so nothing already committed is lost.
---

## 12. Task breakdown

_Re-sequenced 2026-09-29 to the Q1 ruling. **This is launch scope**, so the old header ("Stage 9, Phase 4. None of this gates launch and none is dispatched before task 038") is wrong and is replaced rather than annotated._

**Numbers 071 to 077, stage 8c, and all seven are inside the launch cut-line** (Code Owner, 2026-09-29). 070 is the highest allocated number; C1 to C3 deliberately hold letters so that 071 onward stay in circulation. They sit in `docs/IMPLEMENTATION_PLAN.md` as **stage 8c**, between admin authoring (8a) and distribution (8b), because the work spans the kernel, the ledger, the API, both respondent paths, the admin and the downstream, so no single existing stage holds it.

**There is no launch subset.** An earlier draft of this section named 071 to 074 as a minimum shippable slice and left 076 and 077 as demand-ordered work that might arrive after launch; a later revision moved 075 inside and kept the other two out. **Both are superseded: launch includes all three presentations, so 038 waits on 076 and 077 as well.** The stacked, per-instance-step and table presentations are what `docs/PROJECT_GOAL.md` section 5 now promises, and promising three while shipping one would be the cut-line failing in the direction it exists to prevent. **Each task has a work order in `docs/features/`**, `071-repeating-group-kernel.md` through `077-table-presentation.md`, linked from its ledger row, and each cites the acceptance cases it owns.

**A build order still exists, and it is not a scope statement.** 071, 072, 073 and 074 are the load-bearing four and nothing can be demonstrated before them; 075 follows immediately, because until it lands a repeated answer is silently collapsed by `jsonb_object_agg` in the reporting view and dropped by the CSV export's one-column-per-question premise, which is a data-loss window rather than a missing feature; 076 and 077 are presentations of a proven model and are ordered against each other by whichever the Code Owner wants demonstrated first. Every one of the seven is inside launch, so the order is a sequencing convenience and never a licence to stop.

**Sequencing against real dependencies, not against 038.** The old sequencing was "after task 038" for every task, which the ruling voids. What replaces it is each task's own dependency list:

- **071 depends on nothing in flight.** It is the kernel change and it can start immediately.
- **072 depends on 071** for the id types and the roster shape.
- **073 depends on 071, 072 and on the fix for issue #968**, which it now carries itself (see below).
- **074 depends on 071 and 073.** Part of it is forced into 071 already, because the admin does not typecheck once core gains an operator.
- **075 depends on 071, 072 and 073.**
- **076 and 077 each depend on 073** and on nothing else.
- **038 (external launch validation) depends on all seven**, which is the direction that reversed: launch validation walks a repeating group, exports it and reads it back, and the launch promise covers all three presentations, so 071 to 077 land before 038 rather than after it.

**Issue #968 is a deliverable of 073, not a prerequisite of it** (Q20, ruled 2026-09-29). #968 records that the required-answer sweep runs before the session lock, so a concurrent retraction can leave the ledger and the submission out of step; a repeat multiplies that window by the number of fields a step posts, and the no-JS path posts a whole step at once. The batch answer endpoint 073 builds is the natural place the same class of race is fixed, so the ruling puts both in one piece of work rather than leaving a dependency to be scheduled.

**Gates per task.** Every task runs `pnpm verify`. A task touching `apps/portal`, `apps/admin` or `@roonga/qcms-ui` also runs `QCMS_PORT_SEAT=<0-9> pnpm verify:browser`, detached. A task touching Docker-backed suites also runs the forced run (`pnpm exec turbo run test --force`, confirming it executed rather than cached), and a task changing the boot environment runs `QCMS_PORT_SEAT=<0-9> pnpm up:e2e`. Tasks 064 to 070 stay Phase 4 and outside 038's blockers, and by the Code Owner's direction of 2026-09-29 they are **being built now**, in the same period as this work; the ledger's direction paragraph in `docs/features/README.md` is the record. Under Q50 of `plan/environments-and-workspaces.md`, **064 merges only after 072, 073 and 075 have merged**, so nothing here rebases onto the new baseline and nothing here runs its suites once per environment. **Once 064 has landed, the lanes still open, 073 to 077 among them, run their browser and cross-service gates once per environment**, and the gate time doubles with it.

### Track A - the model and the ledger

**071 - The repeating group in the kernel** (`docs/features/071-repeating-group-kernel.md`). No dependency in flight. Q2, Q4, Q5, Q6, Q7, Q8, Q12, Q13, Q14 and Q15 all bear on it.

_Deliverables._ `GroupId` and `InstanceId` branded ids. `RepeatGroup`, `RepeatCount` and the widened `Step.items`. The widened `AnswerMap` key and the optional `rosters` parameter on `evaluateRules`. The per-instance forward pass and the **three** new operators, with `conditionDepth` reaching into `anyInstance` and `everyInstance`, and **`everyInstance` over an empty roster short-circuiting to false as a base case rather than folding to a true identity**. `documentOrder` expanding a group into a span, and `analyzeRuleGraph` applying the forward-only rule to a span. `checkRuleTypes` gaining branches for all three operators. The new publish codes of section 3.1 **except `TABLE_COLUMN_TYPE_NOT_ALLOWED`, which 077 carries**: `REPEAT_MAX_MISSING` on both bounded count sources, `RULE_TARGETS_SPAN_SCOPES` for a rule whose `show` list straddles a group boundary, and `REPEAT_EVALUATION_BUDGET_EXCEEDED` with the `REPEAT_EVALUATION_BUDGET` constant behind it; plus the new submission code of section 3.3. `collectReferences`, `checkCondition` and `evalCondition` are the three functions the operators branch in, and `collectReferences` is the one forward-only rule 2 depends on. The optional `FlowState` fields of section 3.5. `SNAPSHOT_SCHEMA_VERSION` to 2. Appended golden evaluator scenarios and corpus-local forms, **including the empty-group `everyInstance` case**. **And the admin's parallel operator list in `apps/admin/lib/forms/condition.ts`, in this PR**, because the type-only import means the admin does not typecheck without it; nothing else in the admin moves here. **No instance ceiling constants**: the Q14 ruling removed them, and their absence is asserted by case 10 rather than left implicit.

_Exit criteria._ Acceptance cases 1, 2, 3 and 6 to 21, and the hand-spelled operator list in `visibility-rule.test.ts` naming sixteen operators deliberately. Plus: no `expected` block in `packages/core/golden/evaluator/` is modified, asserted by `check:golden-append-only` rather than by review; `SEMANTICS_VERSION` is still 1, asserted by the constant and by case 1 passing; and the `everyInstance` empty-group reading is pinned by case 13, which also asserts the non-equivalence with `not(anyInstance(not c))`.

_Gates._ `pnpm verify`.

**072 - The instance ledger** (`docs/features/072-instance-ledger.md`). Depends on 071.

_Deliverables._ `answers.instance_id`, the widened `DISTINCT ON` in `latestAnswers` and the widened index. The `answer_group_instances` table with its two triggers, its CHECK, its index and its foreign key, in an appended migration. The roster read and the add and remove writes as query helpers. `eraseSession` and `purgeExpired` reaching the new table behind the existing door. The hand-kept `AnswerRow` type and its `_AnswerRowMatchesTable` guard (issue #5). `EXPECTED_TABLES` (issue #861). **And the reconciled counts in ADR-40**: this table adds four per-environment guards (two triggers, one CHECK and one index) and one foreign key, taking the set to **seventeen guards, eight foreign keys, eight data-plane tables and twenty-five objects** per environment once the #995 rulings' own thirteenth guard is counted with them, with the two new trigger functions single in `control`, so task 064's generator emits them when that Phase 4 track runs.

_Exit criteria._ Acceptance cases 22 to 26. Plus: an erasure leaves no row in any of the three tables, asserted by count against a real Postgres rather than by reading the code, because the erasure table list is hand-kept and a missing entry is silent.

_Gates._ `pnpm verify`, forced Docker-backed run.

### Track B - serving

**073 - Repeat rendering, the roster operation, both paths, and issue #968** (`docs/features/073-repeat-rendering.md`). Depends on 071 and 072. Q9, Q11, Q12, Q15, Q20, Q21.

_Deliverables._ The compiler's `RepeatGroup` template node, `A2UI_SPEC_VERSION` and `COMPILER_VERSION` moves, and the new golden generation carrying the seven existing forms unchanged plus repeat forms. `docs/a2ui-mapping.md` gaining the node. The renderer's render-time expansion and name qualification, keyed per instance (issue #144's rule, one control instance per field). `documentForVisible` and `commitMoments` reaching qualified names. The API's step projection carrying the roster. The batch answer endpoint (Q20) and the roster-operation endpoint. **The fix for issue #968 in the same work** (Q20): the required-answer sweep moves inside the session lock, so the ledger and the submission cannot diverge under a concurrent retraction, and the batch endpoint takes the same lock once for a whole step. The portal's `__qop` decoding, the `formnovalidate` buttons, **the ruled no-commit behaviour of an Add or Remove post** (the roster operation only, no answer write, the typed values carried back in a 200 re-render from the POST body, and a one-time operation token so a replay is a no-op), the focus landing, the `role="status"` region, the instance-naming error summary, and the Continue path's re-render change with `{error, constraint, value}` per refused field, a cap stated in fields and the ruled overflow behaviour (Q21). **The batch endpoint's per-entry rate limiting**, because `answersPerSessionLimiter` keys per request today and a batch would otherwise multiply the per-session allowance by the batch size (SEC-16). **The stacked presentation, one input per row at every width, all seven question types** (Q12). All three count sources. `docs/portal-constraints.md` updated in the same change. **And the template mirror** under `packages/create-qcms-app/templates/common/`, which `check:templates` enforces.

_Exit criteria._ Acceptance cases 4, 5, 27 to 38, and 54 to 57. Plus: the no-JS claim's seven named specs still pass, and an eighth joins them for the repeat walk; `docs/portal-constraints.md`'s exception list is still empty **and its "a required question cannot be CLEARED without scripting" bullet is unchanged**, asserted by case 27 rather than amended. **And issue #968 closes with this PR**, with a test that fails against the pre-change ordering rather than a claim that the ordering changed.

_Gates._ `pnpm verify`, `pnpm verify:browser` detached, forced Docker-backed run, `pnpm up:e2e`.

**074 - Authoring a repeating group** (`docs/features/074-authoring-repeating-groups.md`). Depends on 071 and 073. Q4, Q6, Q7, Q12.

_Deliverables._ The widened `DraftStep.items` and the pure group mutations in `lib/forms/draft.ts`. The group panel of section 6.2, with `max` a required field on the two bounded count sources and the publish refusal surfaced where the author sets it. Group boundaries in `step-editor.tsx` and `lib/forms/pin-grid.ts`, and a group node in the rail tree. The rules editor's scope chip, the **three** structured operator editors, `rule-sentence.ts` including the `everyInstance` sentence that states its own non-vacuous reading, `eligibleTargets` over a span. The test bench's instance dimension, **evaluable at zero instances**, and the draft-preview endpoint change behind it. `draft-preview.tsx` expanding a group with a locally minted roster.

_Exit criteria._ Acceptance cases 58 to 61.

_Gates._ `pnpm verify`, `pnpm verify:browser` detached.

### Track C - downstream and the remaining presentations

**075 - Export, reporting and the webhook payload** (`docs/features/075-repeat-downstream.md`). Depends on 071, 072 and 073. Q17, Q18, Q19.

_Deliverables._ **Both CSV shapes** (Q17): the long shape as the default, with the group files and the zip and the wide file unchanged, and the indexed wide shape as an option on the export route and the export screen, with the header-follows-`max` consequence documented beside the route and not only in this plan. The reporting view generator: `answers_flat.instance_id`, the group key in `responses.answers`, and the `jsonb_object_agg` fix. `docs/reporting-view.md` and its drift test in the same change, with the `@roonga/qcms-db` minor. `LockedAnswer.instanceId` reaching the outbox payload inside `answers` and nowhere else. `docs/webhooks.md` gaining an example. SEC-13's allowlists gaining `ins_`.

_Exit criteria._ Acceptance cases 46 to 53. Plus: a walk of the payload asserting no respondent content outside the `answers` key, because the redaction and its CHECK both depend on that and nothing else states it.

_Gates._ `pnpm verify`, forced Docker-backed run.

**076 - The per-instance step presentation** (`docs/features/076-per-instance-step.md`). Depends on 073. Q22.

_Deliverables._ `visibleStepViews` populated, the cursor indexing views, `progress` counting them, Back and Continue moving one view, Submit on the last. The admin's presentation switch reaching it and the preview walking it.

_Deliverables, the no-JS half, stated because ADR-28's amendment makes it a design question rather than a detail._ That amendment says the no-JS fallback is a **single readiness-labelled button with no Back control**, so "Back and Continue traverse the views" cannot be a claim about both paths. Without scripting a `perInstanceStep` group serves **the first view whose instance is incomplete**, the single button submits the step and the server chooses the next view, and the group's **Add control appears on the last view** so an open-ended group can still grow. There is no Back on that path, exactly as the amendment says, and the respondent reaches an earlier instance by the review step rather than by a control this task adds.

_Exit criteria._ On the hydrated path: a three-instance group presents as three views, the progress indicator says three, Back and Continue traverse them in roster order, and ADR-28's rule that answering never moves the page by itself holds. On the no-JS path: the walk completes through all three views with one button and no Back, and the Add control is on the last view. 076 owns no numbered acceptance case; this criterion is its whole specification, and section 11's ownership map says so.

_Gates._ `pnpm verify`, `pnpm verify:browser` detached.

**077 - The table presentation** (`docs/features/077-table-presentation.md`). Depends on 073. Q10, Q12.

_Deliverables._ The table layout in `@roonga/qcms-ui`, built on the vendored `Table`'s markup and style map (it is not in the renderer registry today and is a read-only display table). The per-cell label, the row header, the caption, the `<tfoot>` total as presentation. The 390px card reflow and the `overflow-x: auto` box above it. The publish refusal of a disallowed column type, naming the stacked presentation. The admin's column view of the member list and the filtered picker. The `docs/COMPONENT_GUIDELINES.md` checklist items that bind a layout: the no-JS path, the focus targets, the theming rules in `theme-components.css` beneath the ADR-38 scope carrier, the font sweep, the tabular-figures selector for the numeric column, and lint coverage.

_Exit criteria._ Acceptance cases 39 to 45, and 62.

_Gates._ `pnpm verify`, `pnpm verify:browser` detached.

### Build order inside launch

**All seven tasks are launch scope** (Q1 as confirmed on 2026-09-29, and the scope ruling of the same date that put all three presentations in launch). This section is therefore a **build order**, not a scope boundary, and the heading says so: an earlier draft called it "the minimum shippable slice" and named four tasks, which read as a licence to launch without the other three.

**The load-bearing four come first: 071, 072, 073, 074.** Nothing can be demonstrated before them. Without 071 there is no model. Without 072 the roster has nowhere to live and an instance the respondent added is lost on reload. Without 073 nobody can answer one, and 073 is where the two hardest problems live, the no-JS roster operation and the render-time expansion. Without 074 nobody can author one, and 074 cannot be deferred in any case because the admin does not typecheck once 071 adds an operator, so part of it is forced into 071 already.

**075 comes next, and the reason is a data-loss window rather than a feature gap.** Until it lands, a repeated answer is silently collapsed by `jsonb_object_agg` in the reporting view and dropped by the CSV export's one-column-per-question premise. No deployment may use a repeating group before 075, which is why it is early in the order and not merely inside the cut-line.

**076 and 077 close the launch promise.** `docs/PROJECT_GOAL.md` section 5 promises the stacked, per-instance-step and table presentations, so both ship before 038 and neither is demand-ordered out of launch. They are ordered against **each other** by demand: 077 is the one the financial use case asks for by name and 076 is the one a phone benefits from most, and the Code Owner picks which is demonstrated first. Neither may be dropped; dropping one would leave section 5 promising something launch does not have, which is the cut-line failing in the direction it exists to prevent.

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

1. No W3C source found covers **naming a form control inside a data cell**. The tables tutorial, the forms tutorial and the APG are all silent on it. H44 and the APG naming practice are the nearest authorities and are what section 4.5 leans on.
2. `scope` and `headers` associate a **cell** with header cells. No source claims they contribute to a **control's** accessible name.
3. No source states that a visible `<th>` discharges **3.3.2** for the input beneath it. Section 4.4 says so as an inference and names task 030's manual pass as where it is tested.
4. WCAG says nothing about **focus after a deletion**; the APG sentence quoted above is the only authority, it addresses a scripted DOM removal, and nothing found addresses a full-page POST-redirect-GET. The no-JS landing is a decision this plan takes.
5. The APG gives **no no-JS story for `role="grid"`** at all, which is not a disagreement with the recommendation so much as the reason for it.
6. The HTML standard guarantees duplicate-name submission order **per name** and offers no indexing mechanism, so indexed names are an application convention whichever way they are spelled.
