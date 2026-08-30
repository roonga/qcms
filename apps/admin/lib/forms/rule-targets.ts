import { textOf } from "../questions/definition.ts";

import { eligibleTargets } from "./draft.ts";
import type { DraftForm } from "./types.ts";

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
export function targetGroups(draft: DraftForm, references: readonly string[]): TargetGroups {
  const eligible = eligibleTargets(draft, references);
  const eligibleIds = new Set<string>([...eligible.questions, ...eligible.steps]);

  const build = (wanted: boolean): readonly TargetStepGroup[] =>
    draft.steps
      .map((step) => {
        const options: TargetOption[] = [];
        // THE WHOLE-STEP TARGET FIRST, because it is the coarser choice and an author
        // scanning a step decides "all of it or some of it" before deciding which.
        if (step.items.length > 0 && eligibleIds.has(step.stepId) === wanted) {
          options.push({ id: step.stepId, label: step.stepId, kind: "step" });
        }
        for (const item of step.items) {
          if (eligibleIds.has(item.questionId) === wanted) {
            options.push({ id: item.questionId, label: item.questionId, kind: "question" });
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
