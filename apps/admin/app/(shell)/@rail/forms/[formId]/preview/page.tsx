import { FormRailSlot } from "../rail-slot";

/**
 * The §7 rail on the draft-preview screen (issue 561).
 *
 * `plan/admin-ux-audit.md` row 6 gives this screen a rail and rejects width on it outright:
 * it renders what a respondent sees, so a wider container makes the preview lie (§3.4).
 * The rail costs the column nothing, because it is a sibling of `<main>` rather than a
 * child of it, so the narrow cap issue 558 gave this route still measures the same content.
 */
export default function FormPreviewRail({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  return <FormRailSlot params={params} current={{ kind: "section", section: "preview" }} />;
}
