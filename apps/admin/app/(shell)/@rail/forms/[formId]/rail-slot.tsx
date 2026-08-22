import { FormSubtreeRail } from "@/components/forms/form-subtree-rail";
import type { RailCurrent } from "@/lib/forms/subtree-rail";
import { loadFormRail } from "@/lib/server/form-rail";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The one body every form-subtree slot page renders (issue 561).
 *
 * Issue 559 built the rail and wired it on one screen; this rolls it across the rest. The
 * acceptance asks for the shared component "with no per-screen copies of the collapsed
 * summary", and this file is what makes that structurally true rather than a promise:
 * seven slot pages exist, and between them they contain no markup at all. Each is a route
 * declaring two things - that this URL has a rail, and which row of it this screen is -
 * and everything else (the two reads, the degrade-never-raise policy, the summary, the
 * groups, the divider) happens exactly once, here and in the modules below it.
 *
 * ## Why every screen's children are the form's steps
 *
 * §7 of `plan/admin-design-contracts.md` gives the rail two groups, and names the first
 * one "the form's children (its steps)". `plan/admin-ux-audit.md` §3.2 is where that word
 * gets dangerous: on the question detail screen a rail's children would be the question's
 * VERSIONS, and the audit says outright that two meanings for the same furniture is the
 * drift a design language exists to stop. All seven routes wired here are form-scoped, so
 * on every one of them the children are the form's steps and never anything else - not the
 * version list on the history screen, not the response list on the responses screen, and
 * not the one version or the one response the two detail routes are about. The rail is
 * navigation within the FORM's subtree; what a given screen happens to be listing in its
 * own column is the column's business.
 *
 * ## Why a detail route marks its section rather than itself
 *
 * `/forms/{id}/versions/3` and `/forms/{id}/responses/{sessionId}` are not rows of the
 * rail: §7's sibling group is the six sections, and neither the audit nor the contract
 * asks for a rail that grows a row per stored version or per collected response. So each
 * detail route marks the section it lives under, which is the same answer the app already
 * gives on the same URLs: `components/forms/form-tabs.tsx` marks History as
 * `aria-current="page"` on `/versions/3` and has since task 034, and `FormPageHeader`
 * builds its last breadcrumb crumb from the same section name. Deciding differently here
 * would have made one screen say two things.
 */
export async function FormRailSlot({
  params,
  current,
}: {
  readonly params: Promise<{ formId: string }>;
  /** Which row of the rail this screen is. */
  readonly current: RailCurrent;
}) {
  const session = await requireAdminSession();
  const { formId } = await params;
  const rail = await loadFormRail(session, formId);
  // A form that cannot be read gets no rail, and the screen's own 404 or error alert
  // speaks instead. `lib/server/form-rail.ts` owns that policy; this is only its answer.
  if (rail === null) return null;

  return (
    <FormSubtreeRail
      formId={rail.formId}
      slug={rail.slug}
      steps={rail.steps}
      issueCounts={rail.issueCounts}
      current={current}
    />
  );
}
