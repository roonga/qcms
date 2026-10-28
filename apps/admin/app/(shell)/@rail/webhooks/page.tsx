import { WebhookOpsRail } from "@/components/ops/webhook-ops-rail";
import { readWebhookOpsFilters } from "@/lib/ops/list-filters";
import { listAllForms } from "@/lib/server/forms";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The webhook operations rail.
 *
 * `listAllForms` is memoized per request, so this shares the page's round trip rather than
 * paying for the same answer twice.
 */
export default async function WebhookOpsRailSlot({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const forms = await listAllForms(session);
  return (
    <WebhookOpsRail
      forms={forms.ok ? forms.data.map((form) => ({ formId: form.formId, slug: form.slug })) : []}
      filters={readWebhookOpsFilters(await searchParams)}
    />
  );
}
