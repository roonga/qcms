/**
 * Axe-run bookkeeping shared by both frontends' accessibility sweeps.
 *
 * ## Why a rule that is switched on needs to be shown to have run (issue #943)
 *
 * Both sweeps select rules by WCAG tag and then name a handful of extra rules by id,
 * through `options({ runOnly: { type: "tag", values: TAGS }, rules: EXTRA_RULES })`.
 * `ruleShouldRun` consults an explicit `rules[id].enabled` before the tag filter, which is
 * what lets a rule that the tag selection would otherwise drop - `heading-order`, which
 * carries no wcag tag, and `label-content-name-mismatch`, which carries the excluded
 * `experimental` tag - join a tag-selected run.
 *
 * A misspelt id is not the hole this closes: axe throws "unknown rule `x` in
 * options.rules" and the sweep goes red naming it, verified by misspelling one. The hole
 * is the option map going missing while every id in it stays correct. `AxeBuilder#options`
 * REPLACES the accumulated option object rather than merging into it, so a later edit that
 * reaches back for `.withTags(TAGS)` takes the whole `rules` map with it - and the result
 * is a sweep that still reports zero violations, still passes, and no longer checks the
 * class it was extended for. That is the worst shape a gate can take: green, and measuring
 * less than its comment says. So each sweep asserts, per state, that every rule it asked
 * for came back in the results, and that assertion was watched to fail against exactly
 * that edit before it was committed.
 *
 * Every rule axe loads lands in exactly one of the four buckets, `inapplicable` included,
 * so presence in their union is the question "did this rule run", asked without caring
 * what it found. A rule that matched no node on a given screen is a legitimate outcome and
 * is still evidence the rule was loaded.
 *
 * The parameter is typed structurally rather than as axe-core's `AxeResults` so this
 * package needs no axe dependency of its own: the two callers already have one, and the
 * real results object satisfies this shape.
 */

/** One rule's outcome, as axe reports it in each of its four result buckets. */
interface RuleOutcome {
  readonly id: string;
}

/** The four buckets of an axe run: every loaded rule appears in exactly one. */
export interface AxeRunBuckets {
  readonly passes: readonly RuleOutcome[];
  readonly violations: readonly RuleOutcome[];
  readonly incomplete: readonly RuleOutcome[];
  readonly inapplicable: readonly RuleOutcome[];
}

/**
 * The ids from `expected` that this run did not load, in the order given.
 *
 * Empty is the passing answer, and the caller asserts on it, so the failure message
 * belongs to the sweep and can name the state and mode the run was taken in.
 */
export function rulesNotRun(results: AxeRunBuckets, expected: readonly string[]): string[] {
  const ran = new Set(
    [...results.passes, ...results.violations, ...results.incomplete, ...results.inapplicable].map(
      (result) => result.id,
    ),
  );
  return expected.filter((id) => !ran.has(id));
}
