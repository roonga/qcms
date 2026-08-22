import Link from "next/link";
import { notFound } from "next/navigation";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { VersionView } from "@/components/forms/version-view";
import { t } from "@/lib/i18n/en";
import { VERSION_HEADING_ID } from "@/lib/page-headings";
import { previewPortalTheme } from "@/lib/server/config";
import { getForm, getFormVersion } from "@/lib/server/forms";
import { requireAdminSession } from "@/lib/server/session";

/**
 * One published version, rendered from its stored compiled documents (task 034, ADR-18).
 *
 * The only domain read this route makes is `GET /admin/forms/{id}/versions/{v}`, whose
 * `compiled` field is the JSONB frozen at publish time. Nothing here compiles, and the
 * draft-preview endpoint is not reachable from this page at all - which is the property
 * exit criterion 4 checks from the browser.
 *
 * ## The two failed-read branches answer differently, and that is the point
 *
 * `plan/admin-design-contracts.md` §3 says a failed read renders the error alert "and
 * nothing else". Issue 521 fixed what "nothing else" governs, and four sites now assert
 * it (`app/(shell)/form-read-states.test.tsx`): nothing that CLAIMS anything about the
 * failed read. Chrome that stays true is not a claim about it. A breadcrumb, an `h1`,
 * the rail beside the screen and a back link are navigation, and an operator who
 * arrived here from a ticket needs them most at exactly the moment a read fails.
 *
 * So the branches split on what the failed read was carrying, not on how bad it was:
 *
 * - **The FORM read failed** and the header's own inputs went with it. `FormPageHeader`
 *   is built from the slug and the status, both of which came from that read, so there
 *   is no header to render and a bare alert is the honest answer. Deliberate, and pinned
 *   by a test in `version-detail-read-states.test.tsx` so it does not get "fixed"
 *   symmetrically.
 * - **The VERSION read failed**, and by then the form read has already succeeded. The
 *   slug and status are in hand and the version number came from the route params rather
 *   than from the read, so every input the header needs survives. It renders, with the
 *   alert where the version body would be. That is the shape the response detail route
 *   ships (`forms/[formId]/responses/[sessionId]/page.tsx`), and issue 614 is this route
 *   catching up to it.
 */
export default async function FormVersionPage({
  params,
}: {
  readonly params: Promise<{ formId: string; version: string }>;
}) {
  const session = await requireAdminSession();
  const { formId, version } = await params;
  const requested = Number(version);
  if (!Number.isInteger(requested) || requested < 1) notFound();

  const [detail, snapshot] = await Promise.all([
    getForm(session, formId),
    getFormVersion(session, formId, requested),
  ]);

  // The form read failed, so the header's inputs failed with it. See the note above:
  // this branch is deliberately bare, and is not the one issue 614 corrects.
  if (!detail.ok) {
    if (detail.code === "FORM_NOT_FOUND" || detail.code === "INVALID_FORM_ID") notFound();
    return <Alert variant="error">{detail.message}</Alert>;
  }

  const form = detail.data;
  // Built once and rendered by both branches below, so the failure state cannot drift
  // away from the success state again. The version comes from the route params rather
  // than from `snapshot.data`, which is what makes the heading knowable when the version
  // read is the thing that failed; on the success path it is the same number, because the
  // API answers with the parsed path param it was given.
  const chrome = (
    <>
      <FormPageHeader
        formId={form.formId}
        slug={form.slug}
        section="versions"
        status={form.status}
        heading={{
          id: VERSION_HEADING_ID,
          text: t("forms.history.versionHeading", { version: requested }),
        }}
      />
      <Link className="qcms-text-link" href={`/forms/${encodeURIComponent(form.formId)}/versions`}>
        {t("forms.history.backToHistory")}
      </Link>
    </>
  );

  if (!snapshot.ok) {
    if (snapshot.code === "VERSION_NOT_FOUND") notFound();
    return (
      <div className="flex flex-col gap-6">
        {chrome}
        <Alert variant="error">{t("forms.history.failed", { message: snapshot.message })}</Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {chrome}
      <VersionView snapshot={snapshot.data} defaultTheme={previewPortalTheme()} />
    </div>
  );
}
