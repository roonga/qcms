import { notFound } from "next/navigation";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { DeliveryDashboard } from "@/components/ops/delivery-dashboard";
import { WebhookConfig } from "@/components/ops/webhook-config";
import { t } from "@/lib/i18n/en";
import { getForm } from "@/lib/server/forms";
import { listDeliveries, listWebhooks } from "@/lib/server/webhook-ops";
import { requireAdminSession } from "@/lib/server/session";

import {
  createWebhookAction,
  deactivateWebhookAction,
  reactivateWebhookAction,
  retargetWebhookAction,
  rotateSecretAction,
} from "../../../webhooks/actions";

/**
 * One form's webhook endpoints and their delivery history (task 035; wireframe
 * "webhook config", "delivery dashboard").
 *
 * Configuration and deliveries are on the same screen deliberately: the operator loop
 * this task exists to serve is "the target is wrong -> fix it -> put the failed
 * deliveries back", and splitting the two halves across routes would make the loop a
 * navigation instead of a glance. The queue itself is cross-form and lives at
 * `/webhooks`, because that is the shape of the API that backs it.
 *
 * A failed deliveries read renders as a notice above the config rather than failing
 * the page: configuring an endpoint is still possible and is often what the operator
 * came for.
 */
export default async function FormWebhooksPage({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  const session = await requireAdminSession();
  const { formId } = await params;

  const [detail, webhooks, deliveries] = await Promise.all([
    getForm(session, formId),
    listWebhooks(session, formId),
    listDeliveries(session, formId),
  ]);

  if (!detail.ok) {
    if (detail.code === "FORM_NOT_FOUND" || detail.code === "INVALID_FORM_ID") notFound();
    return <Alert variant="error">{detail.message}</Alert>;
  }
  const form = detail.data;

  return (
    <div className="flex flex-col gap-8">
      <FormPageHeader
        formId={form.formId}
        slug={form.slug}
        section="webhooks"
        status={form.status}
      />
      {!webhooks.ok && (
        <Alert variant="error">{t("ops.webhooks.listFailed", { message: webhooks.message })}</Alert>
      )}
      <WebhookConfig
        webhooks={webhooks.ok ? webhooks.data : []}
        create={createWebhookAction.bind(null, form.formId)}
        rotate={rotateSecretAction.bind(null, form.formId)}
        deactivate={deactivateWebhookAction.bind(null, form.formId)}
        reactivate={reactivateWebhookAction.bind(null, form.formId)}
        retarget={retargetWebhookAction.bind(null, form.formId)}
      />
      {!deliveries.ok && (
        <Alert variant="warning">
          {t("ops.deliveries.loadFailed", { message: deliveries.message })}
        </Alert>
      )}
      <DeliveryDashboard deliveries={deliveries.ok ? deliveries.data : []} />
    </div>
  );
}
