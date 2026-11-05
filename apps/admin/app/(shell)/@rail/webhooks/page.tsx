import { WebhookOpsRail } from "@/components/ops/webhook-ops-rail";
import { readWebhookOpsFilters } from "@/lib/ops/list-filters";
import { listAllForms } from "@/lib/server/forms";
import { navigableCapabilities, shellAccess } from "@/lib/server/shell";
import { requireAdminSession } from "@/lib/server/session";

export default async function WebhookOpsRailSlot({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const [forms, access] = await Promise.all([listAllForms(session), shellAccess(session)]);
  return (
    <WebhookOpsRail
      forms={forms.ok ? forms.data.map((form) => ({ formId: form.formId, slug: form.slug })) : []}
      filters={readWebhookOpsFilters(await searchParams)}
      showQueues={navigableCapabilities(access).siteConfiguration}
    />
  );
}
