import { notFound } from "next/navigation";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { PublicFormLink } from "@/components/forms/public-form-link";
import { SecureLinks } from "@/components/forms/secure-links";
import { publicFormLink } from "@/lib/forms/public-link";
import { t } from "@/lib/i18n/en";
import { readState } from "@/lib/read-state";
import { portalBaseUrl } from "@/lib/server/config";
import { getForm } from "@/lib/server/forms";
import { listLinks, MAX_LINK_BATCH } from "@/lib/server/links";
import { requireAdminSession } from "@/lib/server/session";

import { mintLinksAction, revokeLinkAction } from "../../actions";

/**
 * The secure-link screen (task 034; screen contract "secure links").
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
  const publicLink = publicFormLink(form, portalBaseUrl());

  return (
    <div className="flex flex-col gap-6">
      <FormPageHeader formId={form.formId} slug={form.slug} section="links" status={form.status} />
      {/* THE FORM'S OWN ADDRESS, above the minted ones (Code Owner, 2026-08-26). It moved
          here from the builder because this is the screen an author comes to when they
          need a link to hand out, and it belongs beside the other kind rather than a
          navigation away from it.

          Above the mint control rather than below the table, because the two are easy to
          confuse and the standing address is the one an author usually wants: seeing it
          first is what stops a minted, expiring invitation being sent where a permanent
          address was meant. `plan/admin-shell-poc/responses-poc.html` is emphatic about
          that distinction and this screen is where it matters most, which is why the
          explanation behind the "?" names the difference in the reader's own terms here. */}
      {publicLink !== undefined && (
        <PublicFormLink url={publicLink} isClosed={form.status === "closed"} />
      )}
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
