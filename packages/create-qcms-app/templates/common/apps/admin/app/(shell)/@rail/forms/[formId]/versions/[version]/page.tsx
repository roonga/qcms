import { FormRailSlot } from "../../rail-slot";

/**
 * The §7 rail on one stored version's screen (issue 561).
 *
 * Two decisions this route makes, both of them the same one the app already made on this
 * URL. Its children are the FORM's steps rather than the steps frozen inside the version
 * being read: the rail is navigation within the form's subtree, and a step row leads to
 * the builder, which only ever edits the draft. And the row marked current is Version
 * history, because a stored version is not a row of the rail, and the section strip this
 * rail replaced marked that same row on `/versions/{n}` from task 034 onward.
 *
 * The narrow cap issue 558 gave this route is untouched: the rail is a sibling of `<main>`
 * and takes nothing off the measure (`app/(shell)/layout.tsx`).
 */
export default function FormVersionDetailRail({
  params,
}: {
  readonly params: Promise<{ formId: string; version: string }>;
}) {
  return <FormRailSlot params={params} current={{ kind: "section", section: "versions" }} />;
}
