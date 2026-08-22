import { LifecycleActions } from "@/components/questions/lifecycle-actions";
import { QuestionVersionsRail } from "@/components/questions/question-versions-rail";
import { selectVersion } from "@/lib/questions/version-rail";
import { loadQuestionRail } from "@/lib/server/question-rail";
import { requireAdminSession } from "@/lib/server/session";

import { lifecycleAction } from "../../../questions/actions";

/**
 * The question detail screen's rail (issue 650).
 *
 * ## Why this screen has one, when the issue that asked for it no longer decides that
 *
 * Issue 650 was filed on a sentence in `plan/admin-design-contracts.md` §7, and that
 * document is no longer the authority: `docs/admin-constraints.md` says the POCs are the
 * design, one per screen, and that the contract is description and rationale. So the reason
 * this rail exists is that `plan/admin-shell-poc/question-editor-poc.html` draws one, with
 * this question's versions in it and the lifecycle actions pinned above them. §7's sentence
 * describes the same shape and is why it looks like the form rail beside it.
 *
 * ## Why a slot rather than something the page renders
 *
 * The rail is a **sibling** of the capped content column, not a child. `<main>`'s width is
 * capped per route (issue 558) and that cap is a question about the CONTENT column, so a rail
 * nested inside it would quietly take 240px off the measure this screen was assigned and
 * stand the rail on `<main>`'s padding rather than on the shell's edge. The shell layout
 * cannot render it either: a Next layout is never told which child route matched. A parallel
 * route resolves both, and `@rail/default.tsx` keeps every screen without one rendering as it
 * did.
 *
 * ## Why it reads the query, and why the lifecycle action comes from the page's route
 *
 * The rail and the screen are two React trees rendered from one URL and neither can hand the
 * other a value, so both ask the same pure `selectVersion` about the same `?v=`. A
 * disagreement would be a screen saying two things: a row marked current beside an editor
 * showing another version.
 *
 * `lifecycleAction` is imported from the page's own route rather than re-declared here for
 * the same reason: publish, deprecate and new-version are one server action with one
 * revalidation, and a second copy of it in this segment would be a second place for the
 * `POST` and the redirect to drift.
 */
export default async function QuestionDetailRail({
  params,
  searchParams,
}: {
  readonly params: Promise<{ questionId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const { questionId } = await params;

  // A question that cannot be read gets no rail at all, and the screen's own 404 or error
  // alert speaks instead. `lib/server/question-rail.ts` owns that policy; this is its answer.
  const rail = await loadQuestionRail(session, questionId);
  if (rail === null) return null;

  const selected = selectVersion(rail.versions, (await searchParams)["v"]);
  if (selected === undefined) return null;
  const latest = rail.versions[rail.versions.length - 1];

  return (
    <QuestionVersionsRail
      questionId={rail.questionId}
      versions={rail.versions}
      selected={selected.version}
      actions={
        <LifecycleActions
          action={lifecycleAction}
          questionId={rail.questionId}
          version={selected.version}
          status={selected.status}
          latestVersion={latest?.version ?? selected.version}
        />
      }
    />
  );
}
