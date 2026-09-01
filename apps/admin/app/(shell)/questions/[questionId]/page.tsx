import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Alert, Card } from "@/components/kit";
import { QuestionEditor } from "@/components/questions/question-editor";
import { QuestionPreview } from "@/components/questions/question-preview";
import { StatusTag } from "@/components/questions/status-tag";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { isoDay, selectVersion } from "@/lib/questions/version-rail";
import { previewPortalTheme } from "@/lib/server/config";
import { getPreview, getQuestion } from "@/lib/server/questions";
import { requireAdminSession } from "@/lib/server/session";

import { saveDraftAction } from "../actions";

/**
 * The browser-tab title for this route (issue #536).
 *
 * The question id, which is what this screen's `<h1>` shows and what R6 makes permanent.
 * It is an identifier rather than prose, so there is nothing here for the catalog to hold.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ questionId: string }>;
}): Promise<Metadata> {
  const { questionId } = await params;
  return pageMetadata(questionId);
}

/**
 * One question: a rendered preview and the editor for the selected version (task 032;
 * screen contract "editor `form`").
 *
 * ## Every version is reachable, and only one is editable
 *
 * Every version the question has ever had is listed in the RAIL beside this column, because
 * that history *is* the governance record: what was published, when, and what replaced it.
 * Selecting one puts it in the URL (`?v=3`), so a specific version of a specific question is
 * a link an author can paste into a ticket. The rail and the lifecycle actions moved out of
 * this column in issue 650, to where `plan/admin-shell-poc/question-editor-poc.html` draws
 * them: `app/(shell)/@rail/questions/[questionId]/page.tsx` is the slot, and it reads the
 * same `?v=` through the same `selectVersion` this page does, so the marked row and the
 * rendered version cannot disagree.
 *
 * A draft renders an editable form; a published or deprecated version renders the same
 * form frozen, with the rule stated above it. Rendering the frozen version through the
 * *same* component rather than a separate read-only view is deliberate: an author sees
 * the identical layout whether or not they can type in it, so "why can I not edit this?"
 * is answered by the sentence at the top instead of by the screen looking unfamiliar.
 *
 * ## Which version is selected is decided in one place
 *
 * `selectVersion` and the ISO day formatter live in `lib/questions/version-rail.ts` rather
 * than here, because the rail beside this column has to answer the same question about the
 * same address. Two copies of that rule would be two answers the first time either changed.
 */

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/questions" className="qcms-text-link">
          {t("questions.backToList")}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="qcms-question-id">{detail.data.questionId}</h1>
          <StatusTag status={selected.status} />
        </div>
        <p className="text-sm text-(--color-text-muted)">
          {t("questions.detail.slug")}: {detail.data.slug} · {t("questions.detail.created")}:{" "}
          {isoDay(detail.data.createdAt)} · {t("questions.detail.type")}:{" "}
          {t(`questions.type.${selected.definition.type}`)}
        </p>
      </div>

      {/* The version list and the lifecycle actions used to sit here, in two cards of this
          column. They are the rail's now (issue 650), which is where the screen's POC draws
          them: `app/(shell)/@rail/questions/[questionId]/page.tsx`. They are not repeated
          here, because a navigation rendered twice on one screen is two lists that can
          disagree and two sets of links to walk. */}

      <div className="qcms-card">
        <Card padding="md" radius="md" border>
          <div className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-(--color-text)">
              {t("questions.preview.title")}
            </h2>
            {preview.ok ? (
              <QuestionPreview
                preview={preview.data}
                resetKey={selected.version}
                defaultTheme={previewPortalTheme()}
              />
            ) : (
              <Alert variant="warning">
                {t("questions.preview.unavailable", { message: preview.message })}
              </Alert>
            )}
          </div>
        </Card>
      </div>

      <div className="qcms-card">
        <Card padding="md" radius="md" border>
          <div className="flex flex-col gap-4">
            <h2 className="text-base font-semibold text-(--color-text)">
              {t("questions.editor.heading", { version: selected.version })}
            </h2>
            {selected.status === "deprecated" && (
              <p className="text-sm text-(--color-warning-fg)">
                {t("questions.detail.deprecatedNote")}
              </p>
            )}
            {isFrozen && (
              <p className="text-sm text-(--color-text-muted)">{t("questions.editor.frozen")}</p>
            )}
            {/* Keyed by the selected version: switching versions is a client-side
                navigation of the same route, so without this React would keep the
                mounted editor and its state, and `?v=2` would still be showing v1's
                document in v2's form. */}
            <QuestionEditor
              key={`${detail.data.questionId}:${String(selected.version)}`}
              mode="edit"
              action={saveDraftAction}
              initialSlug={detail.data.slug}
              initialDefinition={selected.definition}
              version={selected.version}
              isFrozen={isFrozen}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
