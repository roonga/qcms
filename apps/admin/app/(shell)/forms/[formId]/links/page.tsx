import { notFound } from "next/navigation";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { SecureLinks } from "@/components/forms/secure-links";
import { t } from "@/lib/i18n/en";
import { readState } from "@/lib/read-state";
import { getForm } from "@/lib/server/forms";
import { listLinks, MAX_LINK_BATCH } from "@/lib/server/links";
import { requireAdminSession } from "@/lib/server/session";

import { mintLinksAction, revokeLinkAction } from "../../actions";

/**
 * The secure-link screen (task 034; wireframe "secure links").
 *
 * Two reads, run together because they are independent: the form (for its identity and
 * whether it has a published version to point a link at) and the link list. A links read
 * that fails renders as a notice above the mint control rather than a 404, because minting
 * is still possible and is the thing an author most often came here to do.
 *
 * The list reaches the browser as a `ReadState` (`lib/read-state.ts`, issue 543) rather
 * than as `ok ? data : []` (issues 572, 544). That fallback used to put §3's "No links
 * yet" panel underneath this page's own warning, so a failed read told an author their
 * links were gone. `SecureLinks` drops the table and the panel on a failure and keeps
 * minting, which is a capability the failed read does not touch.
 *
 * Both mutations are bound to this route's form id. Revoke additionally takes the link id
 * from the row, but the *path* it revalidates is this form's, so a revoke can never
 * refresh another form's screen.
 */
export default async function FormLinksPage({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  const session = await requireAdminSession();
  const { formId } = await params;

  const [detail, links] = await Promise.all([getForm(session, formId), listLinks(session, formId)]);

  if (!detail.ok) {
    if (detail.code === "FORM_NOT_FOUND" || detail.code === "INVALID_FORM_ID") notFound();
    return <Alert variant="error">{detail.message}</Alert>;
  }
  const form = detail.data;

  return (
    <div className="flex flex-col gap-6">
      <FormPageHeader formId={form.formId} slug={form.slug} section="links" status={form.status} />
      {!links.ok && (
        <Alert variant="warning">{t("forms.links.listFailed", { message: links.message })}</Alert>
      )}
      <SecureLinks
        formId={form.formId}
        links={readState(links)}
        canMint={form.versions.length > 0}
        maxBatch={MAX_LINK_BATCH}
        mint={mintLinksAction.bind(null, form.formId)}
        revoke={revokeLinkAction.bind(null, form.formId)}
      />
    </div>
  );
}
