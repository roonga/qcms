import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { ErasureElsewhereOffer } from "@/components/ops/erasure-elsewhere";
import { ResponseDetail } from "@/components/ops/response-detail";
import { TombstoneCard } from "@/components/ops/tombstone-card";
import { mayEraseResponses } from "@/lib/ops/erasure";
import { labelsForPins, pinsOf, type QuestionPin } from "@/lib/ops/labels";
import { pageMetadata } from "@/lib/page-title";
import type { QuestionDetail } from "@/lib/questions/types";
import { t } from "@/lib/i18n/en";
import { RESPONSE_HEADING_ID } from "@/lib/page-headings";
import { getForm, getFormVersion } from "@/lib/server/forms";
import { getQuestion } from "@/lib/server/questions";
import { holdsEraserGrantAnywhere } from "@/lib/membership/types";
import { secureCookies } from "@/lib/server/config";
import { readMyAccess } from "@/lib/server/membership";
import { formCellsHeld } from "@/lib/server/operations";
import { erasureScope, getResponse, listErasures } from "@/lib/server/responses";
import { shownEnvironment } from "@/lib/environment";
import { resolvedEnvironment } from "@/lib/server/environments";
import { requireAdminSession } from "@/lib/server/session";

import { eraseSessionAction, unflagResponseAction } from "../../../../../responses/actions";

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ sessionId: string }>;
}): Promise<Metadata> {
  const { sessionId } = await params;
  return pageMetadata(t("ops.detail.heading", { sessionId }));
}

/* Resolve captions from the response's pinned form and question versions so later wording cannot rewrite
   audit evidence. */
export default async function ResponseDetailPage({
  params,
}: {
  readonly params: Promise<{ formId: string; sessionId: string }>;
}) {
  const session = await requireAdminSession();
  const { formId, sessionId } = await params;

  const [form, response, resolved, mine] = await Promise.all([
    getForm(session, formId),
    getResponse(session, formId, sessionId),
    resolvedEnvironment(session),
    readMyAccess(session),
  ]);
  const shown = shownEnvironment(resolved);

  // Ask for cross-environment erasure offers only when the caller may erase; the API still authorizes each
  // offer.
  const mayErase = mine.ok && holdsEraserGrantAnywhere(mine.data);
  const scope = mayErase ? await erasureScope(session, formId, sessionId) : undefined;
  const elsewhere = scope?.ok === true ? scope.data.otherEnvironments : [];
  // The erase cell on this form in this environment, which an owner holds through their member role and a
  // response viewer holds nowhere (Code Owner, 2026-11-05).
  const erasable =
    shown !== undefined && mayEraseResponses(await formCellsHeld(session, formId, shown));

  if (!form.ok && (form.code === "FORM_NOT_FOUND" || form.code === "INVALID_FORM_ID")) notFound();
  // The subject here is the response, and a `responses.viewer` holds no `form: read`, so a
  // refused form read costs the status line rather than the screen. The same stance the
  // pinned-version read below already takes for its labels.
  const formHeader = { formId, section: "responses", heading: responseHeading(sessionId) } as const;
  const withStatus = form.ok ? { ...formHeader, status: form.data.status } : formHeader;

  if (!response.ok) {
    // Consult tombstones before returning 404: an erased response remains evidence at its original URL.
    const tombstone =
      response.code === "RESPONSE_NOT_FOUND"
        ? await findTombstone(session, formId, sessionId)
        : undefined;
    if (response.code === "RESPONSE_NOT_FOUND" && tombstone === undefined) notFound();
    return (
      <div className="flex flex-col gap-6">
        <FormPageHeader {...withStatus} />
        <Link className="qcms-text-link" href={responsesHref(formId)}>
          {t("ops.detail.back")}
        </Link>
        {tombstone === undefined ? (
          <Alert variant="error">{t("ops.detail.loadFailed", { message: response.message })}</Alert>
        ) : (
          <TombstoneCard tombstone={tombstone} />
        )}
        <ErasureElsewhereOffer others={elsewhere} secureCookies={secureCookies()} />
      </div>
    );
  }

  const { pins, labels, failed } = await resolveLabels(session, formId, response.data.formVersion);

  return (
    <div className="flex flex-col gap-6">
      <FormPageHeader {...withStatus} />
      <Link className="qcms-text-link" href={responsesHref(formId)}>
        {t("ops.detail.back")}
      </Link>
      <ErasureElsewhereOffer others={elsewhere} secureCookies={secureCookies()} />
      <ResponseDetail
        environment={shown ?? t("environment.unknown")}
        detail={response.data}
        pins={pins}
        labels={labels}
        labelsFailed={failed}
        linksHref={`/operations/forms/${encodeURIComponent(formId)}/links`}
        erasable={erasable}
        erase={eraseSessionAction.bind(null, formId, shown)}
        unflag={unflagResponseAction.bind(null, formId, shown)}
      />
    </div>
  );
}

function responseHeading(sessionId: string): { readonly id: string; readonly text: string } {
  return { id: RESPONSE_HEADING_ID, text: t("ops.detail.heading", { sessionId }) };
}

function responsesHref(formId: string): string {
  return `/operations/forms/${encodeURIComponent(formId)}/responses`;
}

/* Fetch only pinned question versions; a failed label lookup falls back to its id without hiding the audit
   view. */
async function resolveLabels(
  session: Awaited<ReturnType<typeof requireAdminSession>>,
  formId: string,
  version: number,
): Promise<{
  readonly pins: readonly QuestionPin[];
  readonly labels: ReadonlyMap<string, string>;
  readonly failed: boolean;
}> {
  const snapshot = await getFormVersion(session, formId, version);
  if (!snapshot.ok) return { pins: [], labels: new Map(), failed: true };

  const pins = pinsOf(snapshot.data.definition);
  const questionIds = [...new Set(pins.map((pin) => pin.questionId))];
  const details = await Promise.all(
    questionIds.map(async (questionId) => getQuestion(session, questionId)),
  );
  const resolved = details
    .filter((entry): entry is { ok: true; data: QuestionDetail } => entry.ok)
    .map((entry) => entry.data);
  return { pins, labels: labelsForPins(pins, resolved), failed: false };
}

/* Filter at the API: the erasure log grows without bound, while this is a single-session lookup. */
async function findTombstone(
  session: Awaited<ReturnType<typeof requireAdminSession>>,
  formId: string,
  sessionId: string,
) {
  const erasures = await listErasures(session, formId);
  if (!erasures.ok) return undefined;
  return erasures.data.find((row) => row.sessionId === sessionId);
}
