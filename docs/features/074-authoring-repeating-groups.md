# 074 - Authoring a repeating group

**Stage:** 8c (launch scope) · **Apps/packages:** `apps/admin`, `apps/api` (the draft-preview endpoint) · **Depends on:** 071 (the model and the operators), 073 (the renderer the preview shares)
**References:** ADR-42 · ADR-03 as amended 2026-09-30 (three operators, the `everyInstance` reading, the two publish refusals) · ADR-19 (the structured editor is the default, not a fallback) · ADR-25 · SEC-16 · `plan/repeating-groups-and-table-input.md` section 6, and Q4, Q6, Q7, Q12 · `docs/COMPONENT_GUIDELINES.md`

## Context

A question does not know it is repeated, which is the property that keeps ADR-02 and R6 clean and lets the same library question be single in one form and repeated in another. So **the question editor does not change**: `QUESTION_TYPES`, `ConstraintsView`, `QuestionDefinitionView`, the option grid and the eight registration sites of `scripts/component-registration.test.ts` are all untouched, and no component is registered. That is the largest practical dividend of ADR-42's choice of a presentation over a question type, and it is worth stating where an implementer will look for it.

What changes is the **form builder**, the **rules editor** and the **test bench**. Part of this task was already forced into 071: `apps/admin/lib/forms/condition.ts` is tied to the `Condition` union by a type-only import, so the admin does not typecheck until the parallel operator list moves with the kernel. Everything else is here.

## Deliverables

- **The draft assistant's system prompt documents the three whole-group operators, and its exclusion set goes away.** Task 071 left `apps/api/src/features/forms/assist/system-prompt.ts` naming thirteen operators and `system-prompt.test.ts` carrying a named `NOT_DOCUMENTED` set for the other three, because a proposal cannot invent a `groupId` for a group no author can create yet. This task is where an author can create one, so the operators join `CONDITION_OPERATORS`, the set is deleted, and `SYSTEM_PROMPT_VERSION` moves. **The prompt must also say the three cannot nest** (`REPEAT_OPERATOR_NESTING_NOT_ALLOWED`, Q25 ruled 2026-09-29), because a model that nests them writes a draft publish refuses.

- **`DraftStep.items` widened** from `DraftPin[]` to a union with a draft group, mirroring the kernel, and the pure mutations in `apps/admin/lib/forms/draft.ts` gaining `addGroup`, `removeGroup`, `addPinToGroup`, `movePinWithinGroup`, `setGroupCount` and `setGroupPresentation`, following that file's existing shape: the component holds the draft and every mutation is a pure function tested on its own.
- **The group panel**, in this order: name and group id; the member question list, drawn with the same ownership grid the step editor already uses, so form-owned cells get controls and library-owned cells are text; the count source as a three-way radio with a question picker for `fromAnswer`; `min` and `max`; the instance label template with a live preview; and the presentation as a three-way radio.
- **`max` is a required field on `fromAnswer` and on `open`**, and the panel says so where the author sets it rather than leaving `REPEAT_MAX_MISSING` to arrive at publish. A `fixed` count shows no `max` at all, because the count is the bound.
- **Group boundaries in the grid and the rail**: `step-editor.tsx` and `lib/forms/pin-grid.ts` gain group boundaries; `rail-steps.tsx` and `lib/forms/subtree-rail.ts` gain a group node in the rail tree.
- **Scope is shown, not authored.** When a rule's target sits inside a group, the editor states it on the rule as a chip reading "evaluated per passenger", using the group's own label. The author writes an ordinary condition.
- **Structured editors for all three new operators.** `anyInstance` and `everyInstance` are each a group picker plus a nested condition, reusing the existing nested-condition editor and its depth accounting; `instanceCount` is a group picker, a comparison picker and a number.
- **`lib/forms/rule-sentence.ts` gaining the sentences, including the two that have to say their own reading out loud.** `everyInstance` renders as "every passenger ... (and there is at least one passenger)", because the empty group evaluates to **false** by decision and an author reading the bare sentence would supply the classical reading instead. **Its negation renders its own reading too**: `not(everyInstance(...))` is **true** over an empty group, so a warning phrased as a negation would fire for a group with no instances, and that is the trap an author is more likely to write by accident.
- **The two publish refusals surfaced where the author can act on them.** `RULE_TARGETS_SPAN_SCOPES` tells the author to **split the rule into two**, which is always possible and changes nothing about what either rule means. `REPEAT_EVALUATION_BUDGET_EXCEEDED` names both groups, both maxima and the product, and says that the refusal is about this rule's cost and not about either group's size.
- **`rule-targets.ts` and `eligibleTargets`** applying the forward-only rule over a **span** rather than a position.
- **The test bench's instance dimension**: the author adds hypothetical instances, fills per-instance answers and reads a per-instance match or no-match, and the bench is **evaluable at zero instances**, where an `everyInstance` rule reports no match and its negation reports a match. That is the surface where an author discovers that a rule they wrote reads the whole group rather than one instance, and where the empty-group reading is discoverable rather than documented.
- **The draft-preview endpoint change behind the bench**, and `draft-preview.tsx` expanding a group through the same renderer the portal uses, with a roster minted locally from the draft's `min` or from a count the author types rather than from session state the preview does not have.
- **Localised chrome for everything above** (ADR-27), keyboard operable, visible focus.

## Exit criteria

Acceptance cases **58 to 61** of `plan/repeating-groups-and-table-input.md` section 11. This task owns those and no others; case 62, the library picker's filtered list, belongs to 077 because it is the table presentation's refusal being surfaced. Plus:

1. Every group mutation in `lib/forms/draft.ts` is a pure function with its own test, on the pattern that file already sets.
2. The `everyInstance` sentence and its negation both state their empty-group reading, asserted on the rendered sentence rather than on the builder.
3. The test bench evaluates at **zero** instances and reports the ruled result for both the plain and the negated form.
4. `pnpm verify` green; `QCMS_PORT_SEAT=<0-9> pnpm verify:browser` green, run detached, since this touches `apps/admin`.

## Files and areas

`apps/admin/lib/forms/`: `draft.ts`, `pin-grid.ts`, `subtree-rail.ts`, `rule-sentence.ts`, `rule-targets.ts`. `apps/admin/components/forms/`: the step editor, the rail, the group panel, the rule editor and its operand controls, the test bench, `draft-preview.tsx`. The draft-preview endpoint in `apps/api`. The admin i18n catalog.

## Gates

`pnpm verify`, and `QCMS_PORT_SEAT=<0-9> pnpm verify:browser` run detached (`verify:browser:detached`, then `verify:browser:wait <dir>` in slices until it stops exiting 75, never in the foreground: issue #846). No Docker-backed gate.

## Out of scope (binding)

The question editor, `QUESTION_TYPES` and the component registry: none of them moves, and if this task finds itself registering a component something has gone wrong. The parallel operator list in `lib/forms/condition.ts`, which 071 carried. **The admin's column view of a table-presented group's member list, and the library picker filtered to the five allowed cell types: 077 owns both**, together with acceptance case 62, because they are that task's publish refusal being surfaced in the admin rather than group authoring in general. This task's group panel offers the presentation switch and nothing behind the table option. The table layout itself (077) and the per-instance step walk (076). The visual drag-and-drop condition builder, which is Phase 4 and stays there. Any authoring change that would let an author set an instance ceiling: there is none to set.

## Notes for the executor

**The scope chip is the honest half of the design.** Scope is implicit by position, which is what keeps the airline's per-passenger rule an ordinary rule; the price is that an author cannot see the scope in the condition they wrote. The chip is what pays that price, so treat it as a deliverable rather than a decoration.

**The negated `everyInstance` sentence is the one most likely to be skipped**, because the plain sentence reads like the interesting case. It is the other way round: a warning is usually phrased as a negation, so the negation is the sentence an author will actually write.
