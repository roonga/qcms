import Link from "next/link";
import type { Metadata } from "next";

import { Alert } from "@/components/kit";
import { DeadLetters } from "@/components/ops/dead-letters";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { readState } from "@/lib/read-state";
import { shownEnvironment } from "@/lib/environment";
import { readWebhookOpsFilters } from "@/lib/ops/list-filters";
import { resolvedEnvironment } from "@/lib/server/environments";
import { listAllForms } from "@/lib/server/forms";
import { listDeadLetters } from "@/lib/server/webhook-ops";
import { requireAdminSession } from "@/lib/server/session";

import { redeliverAction, redeliverAllAction } from "./actions";

export function generateMetadata(): Metadata {
  return pageMetadata(t("ops.area.webhooks.title"));
}

/* The dead-letter endpoint is global and accepts no form filter; the rail narrows returned rows. */
export default async function WebhooksPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const { formId } = readWebhookOpsFilters(await searchParams);
  const [deadLetters, forms, resolved] = await Promise.all([
    listDeadLetters(session),
    listAllForms(session),
    resolvedEnvironment(session),
  ]);
  const shownQueue =
    formId === undefined || !deadLetters.ok
      ? deadLetters
      : {
          ok: true as const,
          data: deadLetters.data.filter((row) => row.formId === formId),
        };
  const shown = shownEnvironment(resolved);

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
        deadLetters={readState(shownQueue)}
        redeliver={redeliverAction.bind(null, shown)}
        redeliverAll={redeliverAllAction.bind(null, shown)}
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
        {forms.ok &&
          (forms.data.length === 0 ? (
            <p className="text-sm text-(--color-text-muted)">{t("ops.area.webhooks.noForms")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {forms.data.map((form) => (
                <li key={form.formId}>
                  <Link
                    className="qcms-text-link"
                    href={`/operations/forms/${encodeURIComponent(form.formId)}/webhooks`}
                  >
                    {t("ops.area.webhooks.pickForm", { slug: form.slug })}
                  </Link>
                </li>
              ))}
            </ul>
          ))}
      </section>
    </div>
  );
}
