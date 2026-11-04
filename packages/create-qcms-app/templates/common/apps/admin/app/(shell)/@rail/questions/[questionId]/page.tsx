import { NewVersionAction } from "@/components/questions/lifecycle-actions";
import { QuestionVersionsRail } from "@/components/questions/question-versions-rail";
import { questionPanelState } from "@/lib/questions/panels";
import { selectVersion } from "@/lib/questions/version-rail";
import { appLocale } from "@/lib/server/config";
import { loadQuestionRail } from "@/lib/server/question-rail";
import { requireAdminSession } from "@/lib/server/session";

import { lifecycleAction } from "../../../questions/actions";

/* The page and rail are separate trees, so both derive the selected version and panel from the same URL
   helpers. */
export default async function QuestionDetailRail({
  params,
  searchParams,
}: {
  readonly params: Promise<{ questionId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const { questionId } = await params;

  const rail = await loadQuestionRail(session, questionId);
  if (rail === null) return null;

  const query = await searchParams;
  const selected = selectVersion(rail.versions, query["v"]);
  if (selected === undefined) return null;
  const latest = rail.versions[rail.versions.length - 1];
  const { panels, panel } = questionPanelState(selected.definition, query, appLocale());

  return (
    <QuestionVersionsRail
      questionId={rail.questionId}
      slug={rail.slug}
      createdAt={rail.createdAt}
      versions={rail.versions}
      selected={selected.version}
      panels={panels}
      panel={panel}
      actions={
        <NewVersionAction
          action={lifecycleAction}
          questionId={rail.questionId}
          version={selected.version}
          latestVersion={latest?.version ?? selected.version}
        />
      }
    />
  );
}
