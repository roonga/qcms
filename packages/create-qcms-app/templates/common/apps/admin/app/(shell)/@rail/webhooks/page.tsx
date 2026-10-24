import { WebhookOpsRail } from "@/components/ops/webhook-ops-rail";
import { readWebhookOpsFilters } from "@/lib/ops/list-filters";
import { listAllForms } from "@/lib/server/forms";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The webhook operations screen's rail (§7.0, Code Owner 2026-10-24; issue #1117).
 *
 * It exported the no-section stub until §7.0 gave every screen a rail.
 *
 * ## The one read, which is not a second one
 *
 * The Sections are a row per form and the form filter's options are the same forms, so this
 * slot needs the library - which the page beside it has already read. It asks through
 * `listAllForms`, which is memoized per request, so the two trees share one round trip
 * rather than each paying for the same answer (the duplication
 * `lib/server/request-reads.test.ts` exists to hold down).
 *
 * A failed read becomes no rows and no options, not an empty-looking claim: the page is where
 * that failure is reported, in its own alert, and a rail that said "no forms" underneath it
 * would assert what the failed read does not know. That is issue #513's rule on this screen's
 * own body, applied to the column beside it.
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
