import { FormRailSlot } from "../rail-slot";

/**
 * The §7 rail on the per-form webhooks screen (issue 561).
 *
 * This is the widest of the seven (`plan/admin-ux-audit.md` §3.8: a six-column config
 * table above a seven-column delivery dashboard, both holding full URLs), so it is the
 * screen where the rail's 240px track costs the most. It costs the column nothing: the
 * rail is a sibling of `<main>`, so the wide cap issue 558 gave this route still measures
 * the same content it did.
 */
export default function FormWebhooksRail({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  return <FormRailSlot params={params} current={{ kind: "section", section: "webhooks" }} />;
}
