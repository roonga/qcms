import { FormRailSlot } from "./rail-slot";

/**
 * The §7 rail on the builder: the sibling group only (issue 561).
 *
 * ## Why this screen has one group and no divider, and why that is §7 rather than an
 * exception to it
 *
 * Issue 559 wired its reference screen elsewhere and left the builder open, because the
 * builder already renders a step list that is an EDITOR (`components/forms/steps-rail.tsx`)
 * and two step lists on one screen would disagree about what a step row is. That framing
 * made it look like a layout preference. It is not: §7 settles it, through a clause it has
 * carried since it was confirmed.
 *
 * A rail step item is `/forms/{formId}#step-{stepId}` - a route plus the anchor
 * `lib/forms/issues.ts` mints for issue focus. On the other seven screens that is a
 * cross-route link. On the builder the route part IS this route, so the item is a bare
 * same-page fragment, and §7 says the rail "never carries same-page section switches". The
 * children group here is therefore not redundant, it is forbidden.
 *
 * Three consequences, so a reviewer does not read them as defects:
 *
 * 1. **One group, and therefore no divider.** §7's "two groups, in that order, with one
 *    divider" describes the rail where both groups exist. `form-subtree-rail.tsx` already
 *    renders the divider only when there is a children group to separate.
 * 2. **The builder's step editor stays the single step list and keeps its buttons.** It is
 *    content rather than navigation, which is why §7 never reached it. Whether it should
 *    one day resemble the rail's step group, or move, is a builder-layout question that
 *    this rail does not answer and does not foreclose.
 * 3. **Still the one shared component.** Omitting a group is data passed to the rail
 *    (`childrenGroup`), not a per-screen copy of it.
 *
 * It also costs less than the other seven: with no step rows there is no badge, so
 * `lib/server/form-rail.ts` skips the dry-run validation rather than paying for a verdict
 * nothing renders.
 */
export default function FormBuilderRail({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  return (
    <FormRailSlot
      params={params}
      current={{ kind: "section", section: "builder" }}
      childrenGroup="none"
    />
  );
}
