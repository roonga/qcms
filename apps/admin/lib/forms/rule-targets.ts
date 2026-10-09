import { t } from "../i18n/en.ts";
import { textOf } from "../questions/definition.ts";

import { eligibleTargets, findGroup, instanceNoun, questionGroupIds, stepPins } from "./draft.ts";
import type { DraftForm, DraftGroup } from "./types.ts";

/**
 * The `show` list of one rule, arranged the way an author reads a form: by step.
 *
 * ## Why this is a module and not markup
 *
 * The Code Owner's scale for this screen is an insurance organisation with ten or more
 * steps and hundreds of questions, and at that size the arrangement of the target list is
 * the whole of whether the control works. Arrangement that decides usability is a
 * decision, and a decision belongs where it can be tested as one - the same argument
 * `lib/forms/rule-sentence.ts` makes about what a rule SAYS. `rule-targets.test.ts` builds
 * a ten-step form and asserts the grouping and the filter against it; nothing in a
 * rendered tree could have said whether the answer was right.
 *
 * ## Two groups first, steps inside them, and that order is ADR-16's
 *
 * `eligibleTargets` is a single cut through document order: evaluation is one forward
 * pass, so a target is legal exactly when it sits after every question the condition
 * reads. Everything before the cut is illegal and everything after it is legal, which
 * means the eligibility split is coarser than the step split - a step is wholly before
 * the cut, wholly after it, or straddling it, and only one step in a form can straddle.
 *
 * So eligibility is the outer grouping and the step is the inner one. The other order
 * would put "you cannot point a rule here" inside ten separate places instead of stating
 * it once, and the two headings the condition editor has always carried
 * (`forms.rule.targetsEligible` / `forms.rule.targetsIneligible`) are what
 * `e2e/forms-builder.pw.ts` exit criterion 2 reaches for.
 *
 * **The ineligible group is listed, never hidden.** That is the same deliberate choice
 * `lib/forms/draft.ts` records: an author who picks a backward target deserves to be told
 * the rule rather than to find the option missing and wonder why, and exit criterion 2
 * requires the backward attempt to stay reachable through the UI.
 *
 * ## A step's own target rolls up, and it sits with its rollup
 *
 * The kernel expands a step target to every question in it, so a step is a legal target
 * only when all of its questions are - `eligibleTargets` already says so. A straddling
 * step therefore appears in BOTH groups: its whole-step checkbox under "comes before",
 * because pointing at the step would point at the early questions too, and whichever of
 * its questions are past the cut under "comes after". That is not a display quirk, it is
 * exactly what the engine would do, said in two places because it is two different answers.
 */

/** One thing a rule can name in `show`: a pinned question, or a whole step. */
export interface TargetOption {
  readonly id: string;
  /** What the checkbox is called. For a question this is its id, which is its name. */
  readonly label: string;
  readonly kind: "question" | "step";
  /**
   * The repeating group this target sits inside, when it sits in one.
   *
   * **Scope is shown, not authored** (ADR-42 section 6.4). A target inside a group makes the
   * whole rule per-instance, and the author writes no syntax for that - so the editor has to
   * say it, and this is what it says it from. A step target never carries one: a step is the
   * container a group lives in rather than something that lives in a group.
   */
  readonly groupId?: string | undefined;
}

/** One step's targets, within one eligibility group. */
export interface TargetStepGroup {
  readonly stepId: string;
  /** The step's authored title, or its id when the step has not been titled yet. */
  readonly title: string;
  readonly options: readonly TargetOption[];
}

/** Every target of a form, split by eligibility and then by step. */
export interface TargetGroups {
  readonly eligible: readonly TargetStepGroup[];
  readonly ineligible: readonly TargetStepGroup[];
}

/**
 * What scope one rule is evaluated in, read off the targets it names (ADR-42 section 3.4).
 *
 * ## Scope is implicit by position, and that is the honest half of the design
 *
 * A rule whose `show` target sits inside group G is evaluated **once per live instance of
 * G**, and inside that evaluation a reference to another question in G resolves to that
 * instance's answer. No syntax expresses it: the airline's "this passenger is an infant, show
 * this passenger's fare basis" rule is written exactly as an ordinary rule is. That is what
 * keeps the DSL small, and the price is that an author cannot see the scope in the condition
 * they wrote. **The chip the editor renders from this is what pays that price**, so it is a
 * deliverable rather than a decoration.
 *
 * ## `spanning` is a refusal stated before publish, not a third scope
 *
 * `show` is an array, so a list naming one target inside G and another outside it is both
 * per-instance and whole-form, and there is no reading that makes it one thing. Publish
 * refuses it (`RULE_TARGETS_SPAN_SCOPES`) and the remedy is mechanical: split it into one
 * rule per scope, which is always possible because the condition is copyable and the split
 * changes nothing about what either rule means. Computing it here rather than waiting for the
 * round trip is the same bargain `eligibleTargets` makes about a backward target.
 */
export type RuleScope =
  | { readonly kind: "none" }
  | { readonly kind: "form" }
  | {
      readonly kind: "group";
      readonly groupId: string;
      /** The group's own name, as the author wrote it. */
      readonly label: string;
      /** What ONE instance is called, which is the word the chip reads. */
      readonly noun: string;
    }
  | { readonly kind: "spanning"; readonly scopes: readonly string[] };

export function ruleScope(draft: DraftForm, show: readonly string[]): RuleScope {
  if (show.length === 0) return { kind: "none" };
  const groupOf = questionGroupIds(draft);
  const scopes = new Set<string>();
  for (const target of show) {
    // A STEP TARGET IS A FORM-SCOPE TARGET and never a group one, which follows from the
    // kernel rather than being decided here: a step expands to every question in it, and a
    // step holding a group holds questions outside it too, so a step target can never be
    // wholly inside one group. A target the draft does not pin contributes no scope at all -
    // it is `DANGLING_QUESTION_REF` or `DANGLING_STEP_REF`, a different refusal with its own
    // sentence, and guessing a scope for it would put a second complaint on top of the first.
    if (draft.steps.some((step) => step.stepId === target)) {
      scopes.add("form");
      continue;
    }
    const groupId = groupOf.get(target);
    if (groupId !== undefined) scopes.add(groupId);
    else if (draft.steps.some((step) => stepPins(step).some((p) => p.questionId === target))) {
      scopes.add("form");
    }
  }
  const only = [...scopes];
  if (only.length === 0) return { kind: "none" };
  if (only.length > 1) return { kind: "spanning", scopes: only };
  const single = only[0];
  if (single === undefined || single === "form") return { kind: "form" };
  const found = findGroup(draft, single);
  if (found === undefined) return { kind: "form" };
  return {
    kind: "group",
    groupId: single,
    label: groupLabel(draft, found.group),
    noun: instanceNoun(found.group, draft.defaultLocale),
  };
}

/** A group's name for a reader: its label where it has one, its id where it does not. */
function groupLabel(draft: DraftForm, group: DraftGroup): string {
  const label = textOf(group.label, draft.defaultLocale);
  return label === "" ? group.groupId : label;
}

/**
 * The sentence the editor puts on a rule whose targets sit inside a group.
 *
 * Here rather than in the component because it is the same decision `rule-sentence.ts` keeps
 * here - what a rule SAYS is a decision, testable as one - and because the scope chip and the
 * rule table's sentence have to use one vocabulary or an author meets two names for one fact.
 */
export function scopeChipLabel(scope: RuleScope): string | undefined {
  if (scope.kind === "group") return t("forms.rule.scopePerInstance", { noun: scope.noun });
  return undefined;
}

/** How many individual targets a set of groups holds, which is what the filter counts. */
export function countTargets(groups: TargetGroups): number {
  return [...groups.eligible, ...groups.ineligible].reduce(
    (total, group) => total + group.options.length,
    0,
  );
}

/** The step's own name for a reader: its title where it has one, its id where it does not. */
function stepTitle(draft: DraftForm, stepId: string): string {
  const step = draft.steps.find((candidate) => candidate.stepId === stepId);
  const title = step === undefined ? "" : textOf(step.title, draft.defaultLocale);
  return title === "" ? stepId : title;
}

/**
 * Every target this rule could name, grouped for reading.
 *
 * A step with no pins contributes nothing: it has no question to show and the kernel
 * refuses an empty step anyway, so listing it would offer a target that cannot mean
 * anything. `eligibleTargets` already excludes it from the step rollup for the same reason.
 */
export function targetGroups(
  draft: DraftForm,
  references: readonly string[],
  /** The groups the condition reads whole, whose cut is their span's end (ADR-42 §3.4). */
  groupReferences: readonly string[] = [],
): TargetGroups {
  const eligible = eligibleTargets(draft, references, groupReferences);
  const eligibleIds = new Set<string>([...eligible.questions, ...eligible.steps]);
  const groupOf = questionGroupIds(draft);

  const build = (wanted: boolean): readonly TargetStepGroup[] =>
    draft.steps
      .map((step) => {
        const options: TargetOption[] = [];
        // THE WHOLE-STEP TARGET FIRST, because it is the coarser choice and an author
        // scanning a step decides "all of it or some of it" before deciding which.
        if (stepPins(step).length > 0 && eligibleIds.has(step.stepId) === wanted) {
          options.push({ id: step.stepId, label: step.stepId, kind: "step" });
        }
        // A GROUP'S MEMBERS ARE LISTED IN THE GROUP'S OWN PLACE in the step, which is what
        // `stepPins` gives: document order with each group expanded into its member span. A
        // group is not a target of its own - `show` holds question ids and step ids, and
        // nothing else - so there is no checkbox for the container, only for what it holds.
        for (const pin of stepPins(step)) {
          if (eligibleIds.has(pin.questionId) === wanted) {
            const groupId = groupOf.get(pin.questionId);
            options.push({
              id: pin.questionId,
              label: pin.questionId,
              kind: "question",
              ...(groupId === undefined ? {} : { groupId }),
            });
          }
        }
        return { stepId: step.stepId, title: stepTitle(draft, step.stepId), options };
      })
      .filter((group) => group.options.length > 0);

  // `references` is passed in rather than read off the rule here, because the wizard
  // computes it once (`conditionReferences`) and hands the same list to this grouping, to
  // the backward flag and to the bench. Recomputing it per consumer is how three surfaces
  // on one screen come to disagree about what a condition reads.
  return { eligible: build(true), ineligible: build(false) };
}

/**
 * The groups narrowed to what an author typed, with the step's own name searchable.
 *
 * THE STEP IS A UNIT OF SEARCH, not just a heading. Typing part of a step's title or id
 * keeps that whole step, questions included, because "show the claim details step" is the
 * request an author actually has and its questions are not named after it. Typing part of
 * a question id keeps that question wherever it sits, and its step heading comes with it
 * so the answer is still placed. At ten steps and hundreds of questions those are the two
 * gestures that matter, and they are the same two the library picker's search offers over
 * the question library.
 *
 * Case-insensitive substring, deliberately not a fuzzy match: an id is a literal an author
 * copies out of the pin grid, and a matcher that scores near-misses would rank an exact
 * paste below something else. Empty query returns the groups untouched.
 */
export function filterTargets(groups: TargetGroups, query: string): TargetGroups {
  const needle = query.trim().toLowerCase();
  if (needle === "") return groups;

  const narrow = (list: readonly TargetStepGroup[]): readonly TargetStepGroup[] =>
    list
      .map((group) => {
        const stepMatches =
          group.stepId.toLowerCase().includes(needle) || group.title.toLowerCase().includes(needle);
        if (stepMatches) return group;
        return {
          ...group,
          options: group.options.filter((option) => option.label.toLowerCase().includes(needle)),
        };
      })
      .filter((group) => group.options.length > 0);

  return { eligible: narrow(groups.eligible), ineligible: narrow(groups.ineligible) };
}
