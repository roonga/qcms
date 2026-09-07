import { FormRailSlot } from "../rail-slot";

/**
 * The §7 rail on the rules screen (issue #669).
 *
 * The seventh sibling row, and the newest. Rule editing was a SELECTION on the builder
 * until the Code Owner ruled on 2026-09-05 that `plan/admin-shell-poc/rules-screen-poc.html`
 * is built as drawn; it is a route now, so it marks its own row rather than borrowing the
 * builder's.
 *
 * The steps in this rail are the same anchors the other seven non-builder screens render.
 * Nothing on this route publishes to `lib/forms/builder-bridge.ts`, because there is no
 * step editor here to select into, so a step row navigates to the builder and lands on the
 * step it names.
 */
export default function FormRulesRail({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  return <FormRailSlot params={params} current={{ kind: "section", section: "rules" }} />;
}
