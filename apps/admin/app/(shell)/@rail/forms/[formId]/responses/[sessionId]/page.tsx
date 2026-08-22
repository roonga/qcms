import { FormRailSlot } from "../../rail-slot";

/**
 * The §7 rail on one response's screen (issue 561).
 *
 * Same two decisions as the version-detail route, for the same reasons: the children are
 * the form's steps, and the row marked current is Responses, because one collected
 * response is not a row of the rail and the section is what the breadcrumb and the tab
 * strip have both named on this URL since task 035.
 *
 * Nothing about the rail touches the erasure door or the ledger. §7 gives the rail no
 * actions at all, which is what keeps `plan/admin-ux-audit.md` §3.7's constraint intact:
 * the type-to-confirm irreversible action stays visible in the main column and is never
 * reachable from a navigation surface.
 */
export default function FormResponseDetailRail({
  params,
}: {
  readonly params: Promise<{ formId: string; sessionId: string }>;
}) {
  return <FormRailSlot params={params} current={{ kind: "section", section: "responses" }} />;
}
