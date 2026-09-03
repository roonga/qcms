import { FormRailSlot } from "../rail-slot";

/**
 * The §7 rail on the version-history screen (issue 561).
 *
 * The children group here is the form's STEPS, not the version list this screen's own
 * column is showing. `plan/admin-ux-audit.md` §3.2 is explicit that a rail carrying an
 * entity's children on one screen and something else on another is the drift a design
 * language exists to stop, and §5.4's objection to a rail that "repeats the page's own
 * body, and now there are two of them and they can disagree" would land squarely on a rail
 * listing versions beside a table of versions.
 */
export default function FormVersionsRail({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  return <FormRailSlot params={params} current={{ kind: "section", section: "versions" }} />;
}
