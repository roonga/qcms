import Link from "next/link";
import { notFound } from "next/navigation";

import { Alert, Card } from "@/components/kit";
import { LifecycleActions } from "@/components/questions/lifecycle-actions";
import { QuestionEditor } from "@/components/questions/question-editor";
import { QuestionPreview } from "@/components/questions/question-preview";
import { StatusTag } from "@/components/questions/status-tag";
import { t } from "@/lib/i18n/en";
import type { QuestionVersion } from "@/lib/questions/types";
import { getPreview, getQuestion } from "@/lib/server/questions";
import { requireAdminSession } from "@/lib/server/session";

import { lifecycleAction, saveDraftAction } from "../actions";

/**
 * One question: its version history, a rendered preview, and the editor (task 032;
 * wireframe "detail - version timeline" + "editor `form`").
 *
 * ## Every version is reachable, and only one is editable
 *
 * The timeline lists every version the question has ever had, because that history *is*
 * the governance record: what was published, when, and what replaced it. Selecting one
 * puts it in the URL (`?v=3`), so a specific version of a specific question is a link an
 * author can paste into a ticket.
 *
 * A draft renders an editable form; a published or deprecated version renders the same
 * form frozen, with the rule stated above it. Rendering the frozen version through the
 * *same* component rather than a separate read-only view is deliberate: an author sees
 * the identical layout whether or not they can type in it, so "why can I not edit this?"
 * is answered by the sentence at the top instead of by the screen looking unfamiliar.
 *
 * ## The timeline is links, not a table
 *
 * The list screen uses the vendored `Table`, whose cells are strings, so its rows can
 * only be activated with JavaScript. Here the rows are navigation, and navigation should
 * be anchors: they work with JavaScript off, they can be opened in a new tab, and a
 * screen reader announces them as the links they are. The wireframe calls this region a
 * timeline rather than a table, which is the same distinction.
 */

/** ISO day. Rendered on the server, so no locale or timezone can shift it on hydration. */
function isoDay(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function selectVersion(
  versions: readonly QuestionVersion[],
  requested: string | string[] | undefined,
): QuestionVersion | undefined {
  const raw = Array.isArray(requested) ? requested[0] : requested;
  const wanted = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  const match = versions.find((version) => version.version === wanted);
  // Newest by default: an author arriving from the list wants what is current, not the
  // v1 that has not been the answer for a year.
  return match ?? versions[versions.length - 1];
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

  const versions = detail.data.versions;
  const selected = selectVersion(versions, query["v"]);
  if (selected === undefined) notFound();
  const latest = versions[versions.length - 1];
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

      <LifecycleActions
        action={lifecycleAction}
        questionId={detail.data.questionId}
        version={selected.version}
        status={selected.status}
        latestVersion={latest?.version ?? selected.version}
      />

      <div className="qcms-card">
        <Card padding="md" radius="md" border>
          <nav aria-label={t("questions.detail.versions")} className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-(--color-text)">
              {t("questions.detail.versions")}
            </h2>
            <ul className="flex flex-col gap-1">
              {[...versions].reverse().map((version) => (
                <li key={version.version}>
                  <Link
                    href={`/questions/${encodeURIComponent(detail.data.questionId)}?v=${String(version.version)}`}
                    className="qcms-version-row"
                    aria-current={version.version === selected.version ? "true" : undefined}
                  >
                    <span className="qcms-version-row__name">
                      {t("questions.detail.version", { version: version.version })}
                    </span>
                    <StatusTag status={version.status} />
                    <span className="text-sm text-(--color-text-muted)">
                      {version.publishedAt === null
                        ? t("questions.detail.unpublished")
                        : t("questions.detail.publishedAt", { date: isoDay(version.publishedAt) })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </Card>
      </div>

      <div className="qcms-card">
        <Card padding="md" radius="md" border>
          <div className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-(--color-text)">
              {t("questions.preview.title")}
            </h2>
            {preview.ok ? (
              <QuestionPreview preview={preview.data} />
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
