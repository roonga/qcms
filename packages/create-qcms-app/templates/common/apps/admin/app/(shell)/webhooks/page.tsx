import type { Metadata } from "next";

import { Alert } from "@/components/kit";
import { DeadLetters } from "@/components/ops/dead-letters";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { readState } from "@/lib/read-state";
import { shownEnvironment } from "@/lib/environment";
import { readWebhookOpsFilters } from "@/lib/ops/list-filters";
import { queueFormNames } from "@/lib/ops/queue-forms";
import { resolvedEnvironment } from "@/lib/server/environments";
import { listAllForms } from "@/lib/server/forms";
import { listDeadLetters } from "@/lib/server/webhook-ops";
import { requireAdminSession } from "@/lib/server/session";

import { redeliverAction, redeliverAllAction } from "./actions";

export function generateMetadata(): Metadata {
  return pageMetadata(t("ops.area.webhooks.title"));
}

/* The dead-letter endpoint is global and accepts no form filter; the rail narrows returned rows. Form names
   come from the caller's own form read, so a form they cannot read shows its id. */
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
        <h1 className="sr-only">{t("ops.area.webhooks.title")}</h1>
      </div>

      {!deadLetters.ok && (
        <Alert variant="error">
          {t("ops.deadLetters.loadFailed", { message: deadLetters.message })}
        </Alert>
      )}
      <DeadLetters
        deadLetters={readState(shownQueue)}
        formNames={queueFormNames(forms)}
        redeliver={redeliverAction.bind(null, shown)}
        redeliverAll={redeliverAllAction.bind(null, shown)}
      />
    </div>
  );
}
