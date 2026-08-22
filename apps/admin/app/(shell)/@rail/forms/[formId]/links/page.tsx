import { FormSubtreeRail } from "@/components/forms/form-subtree-rail";
import { loadFormRail } from "@/lib/server/form-rail";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The §7 rail on the secure-links screen: the reference implementation (issue 559).
 *
 * ## Why this screen and not the builder
 *
 * Issue 559 builds the rail once and wires it on ONE form-subtree screen, so the other
 * seven (issue 561) get a reviewed component rather than seven copies of an unreviewed
 * one. The builder is the obvious candidate and is the wrong one, for a reason worth
 * writing down before someone tries it:
 *
 * The builder already carries a step list, and that list is an EDITOR
 * (`components/forms/steps-rail.tsx`): its rows are buttons, they select a step inside the
 * page, and they carry add, rename, reorder and remove. §7's rail carries none of that -
 * no actions, no same-page section switches, anchors only. Putting the two side by side
 * would give one screen two step lists that disagree about what a step row is, and folding
 * the editor's commands into the §7 rail would break the contract it is being built from.
 * Reconciling them is a real question about the builder's layout; it is not this issue's,
 * and answering it here would have been answering it quietly.
 *
 * The links screen is a clean reference instead: it is form-scoped, `plan/admin-ux-
 * audit.md` row 9 gives it a rail, it holds no step list of its own to collide with, and
 * it is short enough with no links minted to make N2's viewport-fill visible.
 *
 * ## The page beside it drops its tab strip
 *
 * `components/forms/form-page-header.tsx` renders a `<nav>` of the same six sections this
 * rail carries. Two navigations to the same six routes on one screen is not something any
 * document asks for, so the header takes `sectionsInRail` here and renders the breadcrumb
 * and heading without the strip. Issue 561 passes it on the remaining screens and then the
 * strip and its flag both go.
 */
export default async function FormLinksRail({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  const session = await requireAdminSession();
  const { formId } = await params;
  const rail = await loadFormRail(session, formId);
  if (rail === null) return null;

  return (
    <FormSubtreeRail
      formId={rail.formId}
      slug={rail.slug}
      steps={rail.steps}
      issueCounts={rail.issueCounts}
      current={{ kind: "section", section: "links" }}
    />
  );
}
