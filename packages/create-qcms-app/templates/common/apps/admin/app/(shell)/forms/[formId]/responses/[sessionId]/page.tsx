import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { ErasureElsewhereOffer } from "@/components/ops/erasure-elsewhere";
import { ResponseDetail } from "@/components/ops/response-detail";
import { TombstoneCard } from "@/components/ops/tombstone-card";
import { labelsForPins, pinsOf, type QuestionPin } from "@/lib/ops/labels";
import { pageMetadata } from "@/lib/page-title";
import type { QuestionDetail } from "@/lib/questions/types";
import { t } from "@/lib/i18n/en";
import { RESPONSE_HEADING_ID } from "@/lib/page-headings";
import { getForm, getFormVersion } from "@/lib/server/forms";
import { getQuestion } from "@/lib/server/questions";
<<<<<<< HEAD
import { getResponse, listErasures } from "@/lib/server/responses";
import { shownEnvironment } from "@/lib/environment";
import { resolvedEnvironment } from "@/lib/server/environments";
=======
import { secureCookies } from "@/lib/server/config";
import { erasureScope, getResponse, listErasures } from "@/lib/server/responses";
import { PROD_ENVIRONMENT } from "@/lib/environment";
import { listEnvironments, selectedEnvironment } from "@/lib/server/environments";
>>>>>>> 6e8fbf5c (feat(admin,api,csv): 067 the cross-environment erasure offer, the environment in an export's name, and the restore drill over every environment)
import { requireAdminSession } from "@/lib/server/session";

import { eraseSessionAction, unflagResponseAction } from "../../../../responses/actions";

/**
 * The browser-tab title for this route (issue #536).
 *
 * The session id alone, which is the same string this route's `<h1>` carries. It needs no
 * form: a session id identifies one response across the whole deployment, and two tabs
 * open on two responses of one form was the literal complaint issue #510 was filed for.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ sessionId: string }>;
}): Promise<Metadata> {
  const { sessionId } = await params;
  return pageMetadata(t("ops.detail.heading", { sessionId }));
}

/**
 * One response, with the audit ledger and the erasure door (task 035; screen contract
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

<<<<<<< HEAD
  const [form, response, resolved] = await Promise.all([
=======
  const [form, response, set, scope] = await Promise.all([
>>>>>>> 6e8fbf5c (feat(admin,api,csv): 067 the cross-environment erasure offer, the environment in an export's name, and the restore drill over every environment)
    getForm(session, formId),
    getResponse(session, formId, sessionId),
    // The response above was read from the selected environment's data plane; the erasure
    // confirmation has to name it, because an erasure performed against the wrong
<<<<<<< HEAD
    // environment is not undoable (Q6). The request's one resolution (A12), so the name is
    // the environment the read above was actually made in.
    resolvedEnvironment(session),
  ]);
  const shown = shownEnvironment(resolved);
=======
    // environment is not undoable (Q6).
    listEnvironments(session),
    // Q7's cross-environment offer (task 067). Read beside the response rather than after
    // it, because the case it exists for is the one where the response is **gone** - an
    // operator who has just erased here needs to know where else they have to go, and
    // that branch renders without ever reaching the detail below. A failure is a hint
    // missing and not a screen broken, so this result is only ever read for its offers.
    erasureScope(session, formId, sessionId),
  ]);
  const elsewhere = scope.ok ? scope.data.otherEnvironments : [];
  const environment = await selectedEnvironment(
    set.ok && set.data.length > 0 ? set.data.map((option) => option.name) : [PROD_ENVIRONMENT],
  );
>>>>>>> 6e8fbf5c (feat(admin,api,csv): 067 the cross-environment erasure offer, the environment in an export's name, and the restore drill over every environment)

  if (!form.ok) {
    if (form.code === "FORM_NOT_FOUND" || form.code === "INVALID_FORM_ID") notFound();
    return <Alert variant="error">{form.message}</Alert>;
  }
  if (!response.ok) {
    // A response the API cannot find is usually one that was erased, and this URL is
    // the one an operator has in a ticket. So the erasure log is consulted before
    // giving up: a tombstone renders as the tombstone (which is what ADR-17 says the
    // detail becomes), and only a genuinely unknown session is a 404.
    const tombstone =
      response.code === "RESPONSE_NOT_FOUND"
        ? await findTombstone(session, formId, sessionId)
        : undefined;
    if (response.code === "RESPONSE_NOT_FOUND" && tombstone === undefined) notFound();
    return (
      <div className="flex flex-col gap-6">
        <FormPageHeader
          formId={form.data.formId}
          slug={form.data.slug}
          section="responses"
          status={form.data.status}
          heading={responseHeading(sessionId)}
        />
        <Link className="qcms-text-link" href={`/forms/${encodeURIComponent(formId)}/responses`}>
          {t("ops.detail.back")}
        </Link>
        {tombstone === undefined ? (
          <Alert variant="error">{t("ops.detail.loadFailed", { message: response.message })}</Alert>
        ) : (
          <TombstoneCard tombstone={tombstone} />
        )}
        {/* The offer belongs here most of all: this screen IS a tombstone, so the
            erasure in this environment is done and what is left is the other
            environments the same request has to reach (Q7). */}
        <ErasureElsewhereOffer others={elsewhere} secureCookies={secureCookies()} />
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
        heading={responseHeading(sessionId)}
      />
      <Link className="qcms-text-link" href={`/forms/${encodeURIComponent(formId)}/responses`}>
        {t("ops.detail.back")}
      </Link>
      <ErasureElsewhereOffer others={elsewhere} secureCookies={secureCookies()} />
      <ResponseDetail
        environment={shown ?? t("environment.unknown")}
        detail={response.data}
        pins={pins}
        labels={labels}
        labelsFailed={failed}
        linksHref={`/forms/${encodeURIComponent(formId)}/links`}
        // Bound to the environment this render showed, so an erasure confirmed in a tab
        // another tab has since switched is refused rather than performed elsewhere (A1).
        erase={eraseSessionAction.bind(null, formId, shown)}
        unflag={unflagResponseAction.bind(null, formId, shown)}
      />
    </div>
  );
}

/**
 * The page's own `<h1>`: this response, not the form it belongs to (issue #510).
 *
 * Both branches take it. An erased session is still the session the URL in an operator's
 * ticket names, and heading its tombstone with the form's slug would answer a question
 * nobody asked.
 */
function responseHeading(sessionId: string): { readonly id: string; readonly text: string } {
  return { id: RESPONSE_HEADING_ID, text: t("ops.detail.heading", { sessionId }) };
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

/**
 * The tombstone for one erased session of this form, if there is one.
 *
 * Filtered by form at the API rather than fetched whole and searched here: the log is
 * unbounded over a deployment's lifetime, and this is a lookup, not a listing.
 */
async function findTombstone(
  session: Awaited<ReturnType<typeof requireAdminSession>>,
  formId: string,
  sessionId: string,
) {
  const erasures = await listErasures(session, formId);
  if (!erasures.ok) return undefined;
  return erasures.data.find((row) => row.sessionId === sessionId);
}
