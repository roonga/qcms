// `AxeBuilder#options` replaces the accumulated options rather than merging, so reaching back for
// `.withTags()` silently drops the `rules` map. Typed structurally so this package needs no axe dependency.

interface RuleOutcome {
  readonly id: string;
}

/** Every rule axe loads appears in exactly one bucket, `inapplicable` included. */
export interface AxeRunBuckets {
  readonly passes: readonly RuleOutcome[];
  readonly violations: readonly RuleOutcome[];
  readonly incomplete: readonly RuleOutcome[];
  readonly inapplicable: readonly RuleOutcome[];
}

/** The ids from `expected` this run did not load, in the order given; empty passes. */
export function rulesNotRun(results: AxeRunBuckets, expected: readonly string[]): string[] {
  const ran = new Set(
    [...results.passes, ...results.violations, ...results.incomplete, ...results.inapplicable].map(
      (result) => result.id,
    ),
  );
  return expected.filter((id) => !ran.has(id));
}
