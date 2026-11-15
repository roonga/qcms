import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { PublicFormLink } from "@/components/forms/public-form-link";
import { SecureLinks } from "@/components/forms/secure-links";
import { publicFormLink } from "@/lib/forms/public-link";
import { t } from "@/lib/i18n/en";
import { formSectionName, pageMetadata } from "@/lib/page-title";
import { readState } from "@/lib/read-state";
import { portalBaseUrl } from "@/lib/server/config";
import { getForm } from "@/lib/server/forms";
import { listLinks, MAX_LINK_BATCH } from "@/lib/server/links";
import { isNonProd, shownEnvironment } from "@/lib/environment";
import { resolvedEnvironment } from "@/lib/server/environments";
import { requireAdminSession } from "@/lib/server/session";

import { mintLinksAction, revokeLinkAction } from "../../../../forms/actions";

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}): Promise<Metadata> {
  const { formId } = await params;
  return pageMetadata(formSectionName("links", formId));
}

/* A failed link-list read must not remove minting, which remains available independently. */
export default async function FormLinksPage({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  const session = await requireAdminSession();
  const { formId } = await params;

  const [detail, links, resolved] = await Promise.all([
    getForm(session, formId),
    listLinks(session, formId),
    resolvedEnvironment(session),
  ]);
  const shown = shownEnvironment(resolved);
  const environment = shown ?? t("environment.unknown");

  if (!detail.ok) {
    if (detail.code === "FORM_NOT_FOUND" || detail.code === "INVALID_FORM_ID") notFound();
    return <Alert variant="error">{detail.message}</Alert>;
  }
  const form = detail.data;
  const publicLink = publicFormLink(form, portalBaseUrl());

  return (
    <div className="flex flex-col gap-6">
      <FormPageHeader formId={form.formId} section="links" form={form} />
      {/* The public /f/{slug} address serves production only; non-production access uses secure links. */}
      {/* An unknown environment cannot support either address panel's claim about its destination. */}
      {publicLink !== undefined && shown !== undefined && !isNonProd(shown) && (
        <PublicFormLink url={publicLink} isClosed={form.status === "closed"} />
      )}
      {shown !== undefined && isNonProd(shown) && (
        <Alert variant="info">{t("forms.links.noPublicAddress", { environment: shown })}</Alert>
      )}
      {!links.ok && (
        <Alert variant="warning">{t("forms.links.listFailed", { message: links.message })}</Alert>
      )}
      <SecureLinks
        formId={form.formId}
        environment={environment}
        links={readState(links)}
        canMint={form.versions.length > 0}
        maxBatch={MAX_LINK_BATCH}
        mint={mintLinksAction.bind(null, form.formId, shown)}
        revoke={revokeLinkAction.bind(null, form.formId, shown)}
      />
    </div>
  );
}
