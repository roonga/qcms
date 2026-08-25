import { FormRailSlot } from "./rail-slot";

/**
 * The rail on the builder, which is the one screen where its steps can be worked on.
 *
 * ## This screen used to be the exception, and is not any more
 *
 * Issue 561 gave it the sibling rows alone, on a clause of §7 that barred a rail from
 * carrying a same-page switch: a step row is `/forms/{formId}#step-{stepId}`, which is a
 * cross-route link on the other seven screens and a bare fragment on this one. The clause
 * was retired on 2026-08-25 (Code Owner) along with its companion against actions in a
 * rail, and `plan/admin-design-contracts.md` §7 carries the reversal.
 *
 * What that reasoning produced was a builder whose steps lived in a card inside the page
 * while the rail beside it had none: one screen, two step lists, and no single place that
 * owned them. `plan/admin-shell-poc/admin-shell-poc.html` had drawn the other arrangement
 * all along - steps nested inside the Form row, each with a menu, an add control beneath -
 * and that is what ships now.
 *
 * ## `interactiveSteps` is an upgrade, not a different list
 *
 * Every form screen renders the same nested steps. Here they additionally become buttons
 * that select a step in the editor beside them, once the builder has published its draft
 * through `lib/forms/builder-bridge.ts`. Until it does - and for a reader with no
 * JavaScript - they are the same anchors the other seven screens show, pointing at the
 * fragment `lib/forms/issues.ts` mints for issue focus.
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
      interactiveSteps
    />
  );
}
