import { FormRailSlot } from "../rail-slot";

/**
 * The §7 rail on the release screen (ADR-40, task 065).
 *
 * The children group is the form's **steps**, exactly as it is on every other form-scoped
 * screen. A rail listing environments beside a table of environments would be the shape
 * `plan/admin-ux-audit.md` §5.4 objects to - "it repeats the page's own body, and now there
 * are two of them and they can disagree" - and §3.2 is explicit that a rail carrying an
 * entity's children on one screen and something else on another is the drift a design
 * language exists to stop.
 */
export default function FormReleasesRail({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  return <FormRailSlot params={params} current={{ kind: "section", section: "releases" }} />;
}
