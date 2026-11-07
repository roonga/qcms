import type { Metadata } from "next";
import { QuestionFacts } from "@/components/questions/question-facts";
import { notFound } from "next/navigation";

import { HeadingMarker } from "@/components/agent/heading-marker";
import { Alert, Card } from "@/components/kit";
import { VersionLifecycleActions } from "@/components/questions/lifecycle-actions";
import { QuestionEditor } from "@/components/questions/question-editor";
import { QuestionPreview } from "@/components/questions/question-preview";
import { QuestionSave } from "@/components/questions/question-save";
import { StatusTag } from "@/components/questions/status-tag";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { questionPanelState } from "@/lib/questions/panels";
import { selectVersion } from "@/lib/questions/version-rail";
import { appLocale, previewPortalTheme } from "@/lib/server/config";
import { getPreview, getQuestion } from "@/lib/server/questions";
import { requireAdminSession } from "@/lib/server/session";

import { lifecycleAction, saveDraftAction } from "../actions";

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ questionId: string }>;
}): Promise<Metadata> {
  const { questionId } = await params;
  return pageMetadata(questionId);
}

export default async function QuestionDetailPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ questionId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const { questionId } = await params;
  const query = await searchParams;

  const detail = await getQuestion(session, questionId);
  if (!detail.ok) {
    if (detail.code === "QUESTION_NOT_FOUND" || detail.code === "INVALID_QUESTION_ID") notFound();
    return <Alert variant="error">{detail.message}</Alert>;
  }

  const selected = selectVersion(detail.data.versions, query["v"]);
  if (selected === undefined) notFound();
  const isFrozen = selected.status !== "draft";

  const preview = await getPreview(session, questionId, selected.version);
  const { panel } = questionPanelState(selected.definition, query, appLocale());
  const latestVersion =
    detail.data.versions[detail.data.versions.length - 1]?.version ?? selected.version;

  return (
    <div className="flex flex-col gap-6">
      {/* QuestionSave reads client pending state through the editor bridge and submits the editor's form by id. */}
      <div className="qcms-question-head">
        <div className="qcms-question-head__id">
          <h1>
            <span className="qcms-question-id">{detail.data.questionId}</span>{" "}
            {/* Keep real whitespace around the hidden separator so the heading's accessible name does not join the two
   facts. */}
            <span className="qcms-question-head__sep" aria-hidden="true">
              {"·"}
            </span>{" "}
            <span className="qcms-question-head__version">
              {t("questions.detail.version", { version: selected.version })}
            </span>
          </h1>
          <StatusTag status={selected.status} />
        </div>
        <QuestionSave mode="edit" />
        {/* Place lifecycle controls after the save note and Save in document order so the note is read before its
   control. */}
        <div className="qcms-question-head__lifecycle">
          <HeadingMarker control={["question.save", "question.lifecycle"]}>
            <VersionLifecycleActions
              action={lifecycleAction}
              questionId={detail.data.questionId}
              version={selected.version}
              status={selected.status}
              latestVersion={latestVersion}
            />
          </HeadingMarker>
        </div>
      </div>

      <QuestionFacts
        slug={detail.data.slug}
        createdAt={detail.data.createdAt}
        versions={detail.data.versions}
        selected={selected.version}
      />

      {/* The editor keeps the 720 its POC draws while the head and the facts take the outer cap
   (`plan/admin-design-contracts.md`: the drawn inner number rides on the element). */}
      <div className="qcms-editor-column qcms-card">
        <Card padding="md" radius="md" border>
          <div className="flex flex-col gap-4">
            {/* Key by version: soft navigation otherwise preserves the previous editor state under the new version's
   URL. */}
            <QuestionEditor
              key={`${detail.data.questionId}:${String(selected.version)}`}
              mode="edit"
              action={saveDraftAction}
              initialSlug={detail.data.slug}
              initialDefinition={selected.definition}
              version={selected.version}
              isFrozen={isFrozen}
              isDeprecated={selected.status === "deprecated"}
              addressedPanel={panel}
              // Compile preview server-side and pass the finished subtree into the client editor.
              preview={
                preview.ok ? (
                  <QuestionPreview
                    preview={preview.data}
                    resetKey={selected.version}
                    defaultTheme={previewPortalTheme()}
                  />
                ) : (
                  <Alert variant="warning">
                    {t("questions.preview.unavailable", { message: preview.message })}
                  </Alert>
                )
              }
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
