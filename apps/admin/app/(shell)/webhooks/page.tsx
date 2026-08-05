import Link from "next/link";

import { Alert } from "@/components/kit";
import { DeadLetters } from "@/components/ops/dead-letters";
import { t } from "@/lib/i18n/en";
import { listForms } from "@/lib/server/forms";
import { listDeadLetters } from "@/lib/server/webhook-ops";
import { requireAdminSession } from "@/lib/server/session";

import { redeliverAction, redeliverAllAction } from "./actions";

/**
 * Webhook operations: the dead-letter queue, and a way into each form's endpoints
 * (task 035; wireframe "dead-letter list").
 *
 * The queue is **not** form-scoped, and that is the API's shape rather than a
 * simplification: `GET /admin/outbox/dead-letters` is global, because a stuck
 * delivery is an operational fact about the deployment and the operator's question is
 * "is anything stuck", not "is anything stuck on this one form". Configuration is
 * per-form and stays on the form, which is where an author works.
 */
export default async function WebhooksPage() {
  const session = await requireAdminSession();
  const [deadLetters, forms] = await Promise.all([listDeadLetters(session), listForms(session)]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-(--color-text)">
          {t("ops.area.webhooks.title")}
        </h1>
        <p className="text-sm text-(--color-text-muted)">{t("ops.area.webhooks.intro")}</p>
      </div>

      {!deadLetters.ok && (
        <Alert variant="error">
          {t("ops.deadLetters.loadFailed", { message: deadLetters.message })}
        </Alert>
      )}
      <DeadLetters
        deadLetters={deadLetters.ok ? deadLetters.data : []}
        redeliver={redeliverAction}
        redeliverAll={redeliverAllAction}
      />

      <section aria-labelledby="qcms-webhook-forms-heading" className="flex flex-col gap-2">
        <h2 id="qcms-webhook-forms-heading" className="text-lg font-semibold text-(--color-text)">
          {t("nav.forms")}
        </h2>
        {!forms.ok && (
          <Alert variant="warning">
            {t("ops.area.responses.formsFailed", { message: forms.message })}
          </Alert>
        )}
        {forms.ok && forms.data.length === 0 ? (
          <p className="text-sm text-(--color-text-muted)">{t("ops.area.webhooks.noForms")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {(forms.ok ? forms.data : []).map((form) => (
              <li key={form.formId}>
                <Link
                  className="qcms-text-link"
                  href={`/forms/${encodeURIComponent(form.formId)}/webhooks`}
                >
                  {t("ops.area.webhooks.pickForm", { title: form.slug })}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
