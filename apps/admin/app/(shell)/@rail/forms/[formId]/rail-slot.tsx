import { FormSubtreeRail } from "@/components/forms/form-subtree-rail";
import { RailSteps } from "@/components/forms/rail-steps";
import type { RailCurrent } from "@/lib/forms/subtree-rail";
import { loadFormRail, type RailChildren } from "@/lib/server/form-rail";
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
 * ## Why the children are the form's steps on seven screens, and absent on the eighth
 *
 * §7 of `plan/admin-design-contracts.md` gives the rail two groups, and names the first
 * one "the form's children (its steps)". `plan/admin-ux-audit.md` §3.2 is where that word
 * gets dangerous: on the question detail screen a rail's children would be the question's
 * VERSIONS, and the audit says outright that two meanings for the same furniture is the
 * drift a design language exists to stop. Every route wired here is form-scoped, so where
 * there are children at all they are the form's steps and never anything else - not the
 * version list on the history screen, not the response list on the responses screen, and
 * not the one version or the one response the two detail routes are about. The rail is
 * navigation within the FORM's subtree; what a given screen happens to be listing in its
 * own column is the column's business.
 *
 * The builder asks for `childrenGroup: "none"`, and that is §7 applying to itself rather than
 * an exception to it. A step item is
 * `/forms/{id}#step-{stepId}`, which is a cross-route link on the other seven screens and
 * a bare same-page fragment on the builder, and §7 says the rail "never carries same-page
 * section switches". So the group is not merely redundant beside the builder's step
 * editor: it is forbidden. Omitting it is data passed to the shared component, never a
 * per-screen copy of it, which is why nothing forks here.
 *
 * ## Why a detail route marks its section rather than itself
 *
 * `/forms/{id}/versions/3` and `/forms/{id}/responses/{sessionId}` are not rows of the
 * rail: §7's sibling group is the six sections, and neither the audit nor the contract
 * asks for a rail that grows a row per stored version or per collected response. So each
 * detail route marks the section it lives under, which is the same answer the app already
 * gave on the same URLs: the section strip this rail replaced (`form-tabs.tsx`, retired by
 * issue 561) marked the version-history row as `aria-current="page"` on `/versions/3` from
 * task 034 onward, and `FormPageHeader` still builds its last breadcrumb crumb, and since
 * issue 679 the section half of its `<h1>`, from the same section name. Deciding
 * differently here would have made one screen say two things.
 */
export async function FormRailSlot({
  params,
  current,
  childrenGroup = "steps",
  interactiveSteps = false,
}: {
  readonly params: Promise<{ formId: string }>;
  /** Which row of the rail this screen is. */
  readonly current: RailCurrent;
  /** Which of §7's two groups this screen's rail carries. */
  readonly childrenGroup?: RailChildren;
  /**
   * Whether the nested steps can be worked on rather than only walked to.
   *
   * True on the builder alone, which is the one screen with a draft to change. Everywhere
   * else a step row is a link to the builder's own anchor for it, which is what it has
   * always been. `RailSteps` renders the same anchors until the builder publishes, so this
   * flag turns on an upgrade rather than a different list.
   */
  readonly interactiveSteps?: boolean;
}) {
  const session = await requireAdminSession();
  const { formId } = await params;
  const rail = await loadFormRail(session, formId, childrenGroup);
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
      {...(interactiveSteps ? { renderSteps: (steps) => <RailSteps serverItems={steps} /> } : {})}
    />
  );
}
