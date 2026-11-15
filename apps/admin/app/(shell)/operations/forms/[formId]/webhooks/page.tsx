import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { DeliveryDashboard } from "@/components/ops/delivery-dashboard";
import { EndpointProposals } from "@/components/ops/endpoint-proposals";
import { WebhookConfig } from "@/components/ops/webhook-config";
import { t } from "@/lib/i18n/en";
import { formSectionName, pageMetadata } from "@/lib/page-title";
import { readState } from "@/lib/read-state";
import { shownEnvironment } from "@/lib/environment";
import { resolvedEnvironment } from "@/lib/server/environments";
import { getForm } from "@/lib/server/forms";
import { listDeliveries, listEndpointProposals, listWebhooks } from "@/lib/server/webhook-ops";
import { requireAdminSession } from "@/lib/server/session";

import {
  confirmEndpointChangeAction,
  createWebhookAction,
  deactivateWebhookAction,
  reactivateWebhookAction,
  retargetWebhookAction,
  rotateSecretAction,
  withdrawEndpointChangeAction,
} from "../../../../webhooks/actions";

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}): Promise<Metadata> {
  const { formId } = await params;
  return pageMetadata(formSectionName("webhooks", formId));
}

export default async function FormWebhooksPage({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  const session = await requireAdminSession();
  const { formId } = await params;

  const [detail, webhooks, deliveries, proposals, resolved] = await Promise.all([
    getForm(session, formId),
    listWebhooks(session, formId),
    listDeliveries(session, formId),
    listEndpointProposals(session, formId),
    resolvedEnvironment(session),
  ]);
  // Bind the displayed environment so a later switch in another tab refuses these mutations.
  const shown = shownEnvironment(resolved);

  if (!detail.ok) {
    if (detail.code === "FORM_NOT_FOUND" || detail.code === "INVALID_FORM_ID") notFound();
    return <Alert variant="error">{detail.message}</Alert>;
  }
  const form = detail.data;

  return (
    <div className="flex flex-col gap-8">
      <FormPageHeader formId={form.formId} section="webhooks" form={form} />
      {!webhooks.ok && (
        <Alert variant="error">{t("ops.webhooks.listFailed", { message: webhooks.message })}</Alert>
      )}
      <EndpointProposals
        proposals={readState(proposals)}
        confirm={confirmEndpointChangeAction.bind(null, form.formId, shown)}
        withdraw={withdrawEndpointChangeAction.bind(null, form.formId, shown)}
      />
      <WebhookConfig
        webhooks={readState(webhooks)}
        create={createWebhookAction.bind(null, form.formId, shown)}
        rotate={rotateSecretAction.bind(null, form.formId, shown)}
        deactivate={deactivateWebhookAction.bind(null, form.formId, shown)}
        reactivate={reactivateWebhookAction.bind(null, form.formId, shown)}
        retarget={retargetWebhookAction.bind(null, form.formId, shown)}
      />
      {!deliveries.ok && (
        <Alert variant="warning">
          {t("ops.deliveries.loadFailed", { message: deliveries.message })}
        </Alert>
      )}
      <DeliveryDashboard deliveries={readState(deliveries)} />
    </div>
  );
}
