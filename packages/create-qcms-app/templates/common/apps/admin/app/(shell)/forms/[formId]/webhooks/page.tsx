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
} from "../../../webhooks/actions";

/** The browser-tab title for this route (issue #536): the section, and the form it belongs to. */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}): Promise<Metadata> {
  const { formId } = await params;
  return pageMetadata(formSectionName("webhooks", formId));
}

/**
 * One form's webhook endpoints and their delivery history (task 035; screen contract
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
 *
 * Both list reads reach their components as a `ReadState` (`lib/read-state.ts`, issue
 * 543) rather than as `ok ? data : []` (issues 572, 544). That fallback made a failed
 * read indistinguishable from a form with no endpoint and no delivery, so each component
 * drew its empty state - and the endpoint one is §3's panel with a primary **Add
 * endpoint** call to action, printed directly beneath this page's own alert saying the
 * endpoint list could not be loaded. What each component keeps through a failure is its
 * own decision, which is the point of the type: `WebhookConfig` keeps offering creation
 * because creation does not depend on the list that failed, and `DeliveryDashboard` has
 * nothing to keep.
 */
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
    // What is waiting for a second approver (task 070). Read beside the endpoints rather
    // than on a screen of its own, because the question "what is live here" and the
    // question "what is waiting to be" are asked in one glance - and a pending change is
    // not a state of an endpoint, which is why it renders as its own panel.
    listEndpointProposals(session, formId),
    resolvedEnvironment(session),
  ]);
  // Endpoints live in one environment's data plane, so every mutation below carries the
  // environment this render read them from and is refused once that has changed (A1).
  const shown = shownEnvironment(resolved);

  if (!detail.ok) {
    if (detail.code === "FORM_NOT_FOUND" || detail.code === "INVALID_FORM_ID") notFound();
    return <Alert variant="error">{detail.message}</Alert>;
  }
  const form = detail.data;

  return (
    <div className="flex flex-col gap-8">
      <FormPageHeader
        formId={form.formId}
        section="webhooks"
        status={form.status}
      />
      {!webhooks.ok && (
        <Alert variant="error">{t("ops.webhooks.listFailed", { message: webhooks.message })}</Alert>
      )}
      {/* Above the endpoint list deliberately: a change the operator proposed a moment
          ago, or one a colleague is waiting on, is what they came back for, and the list
          below shows the endpoint still doing what it did. The panel renders nothing at
          all when nothing is waiting, which is the ordinary case - the rule gates `prod`
          alone and is off by default (Q13). */}
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
