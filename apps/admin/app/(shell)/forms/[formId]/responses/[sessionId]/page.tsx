import Link from "next/link";
import { notFound } from "next/navigation";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { ResponseDetail } from "@/components/ops/response-detail";
import { labelsForPins, pinsOf, type QuestionPin } from "@/lib/ops/labels";
import type { QuestionDetail } from "@/lib/questions/types";
import { t } from "@/lib/i18n/en";
import { getForm, getFormVersion } from "@/lib/server/forms";
import { getQuestion } from "@/lib/server/questions";
import { getResponse } from "@/lib/server/responses";
import { requireAdminSession } from "@/lib/server/session";

import { eraseSessionAction, unflagResponseAction } from "../../../../responses/actions";

/**
 * One response, with the audit ledger and the erasure door (task 035; wireframe
 * "detail", "erasure").
 *
 * ## Captions come from the version the response was submitted on
 *
 * The answers arrive keyed by `questionId`. To caption them with the wording the
 * respondent actually saw, this page reads the **response's own form version**
 * (`detail.formVersion`, not the newest), takes the pins out of its frozen
 * definition, and resolves each pinned question version's label. A form republished
 * with reworded questions therefore does not retro-caption an older submission,
 * which would be a quiet falsehood in the one view whose job is to be evidence
 * (R1, R6; `lib/ops/labels.ts` states the rule and is unit-tested against it).
 *
 * When that resolution fails the screen still renders, captioned with ids, and says
 * so in a warning. An id is honest; a wrong label is not, and an unopenable audit
 * view is worse than either.
 */
export default async function ResponseDetailPage({
  params,
}: {
  readonly params: Promise<{ formId: string; sessionId: string }>;
}) {
  const session = await requireAdminSession();
  const { formId, sessionId } = await params;

  const [form, response] = await Promise.all([
    getForm(session, formId),
    getResponse(session, formId, sessionId),
  ]);

  if (!form.ok) {
    if (form.code === "FORM_NOT_FOUND" || form.code === "INVALID_FORM_ID") notFound();
    return <Alert variant="error">{form.message}</Alert>;
  }
  if (!response.ok) {
    if (response.code === "RESPONSE_NOT_FOUND") notFound();
    return (
      <div className="flex flex-col gap-6">
        <FormPageHeader
          formId={form.data.formId}
          slug={form.data.slug}
          section="responses"
          status={form.data.status}
        />
        <Alert variant="error">{t("ops.detail.loadFailed", { message: response.message })}</Alert>
      </div>
    );
  }

  const { pins, labels, failed } = await resolveLabels(session, formId, response.data.formVersion);

  return (
    <div className="flex flex-col gap-6">
      <FormPageHeader
        formId={form.data.formId}
        slug={form.data.slug}
        section="responses"
        status={form.data.status}
      />
      <Link className="qcms-text-link" href={`/forms/${encodeURIComponent(formId)}/responses`}>
        {t("ops.detail.back")}
      </Link>
      <ResponseDetail
        detail={response.data}
        pins={pins}
        labels={labels}
        labelsFailed={failed}
        linksHref={`/forms/${encodeURIComponent(formId)}/links`}
        erase={eraseSessionAction.bind(null, formId)}
        unflag={unflagResponseAction.bind(null, formId)}
      />
    </div>
  );
}

/**
 * Resolve the pinned question wording for one form version.
 *
 * Only the questions this version pins are fetched, not the whole library: the
 * builder needs every question and every version, this screen needs one version's
 * worth, and reusing `loadPinnableQuestions` here would make opening a response cost
 * a detail read per question in the entire library.
 *
 * `failed` means the *version* could not be read, which is the case the operator must
 * be told about. A single question detail that fails only costs that one caption, and
 * `labelFor` already falls back to the id for it.
 */
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
