import Link from "next/link";

import { Select } from "@/components/kit";
import { activeFilterCount, RailFilters } from "@/components/rail-filters";
import { RailCount, RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import type { WebhookOpsFilters } from "@/lib/ops/list-filters";

/** One form, as the rail lists it: a row to its endpoints and an option on the form filter. */
export interface WebhookRailForm {
  readonly formId: string;
  readonly slug: string;
}

/**
 * The webhook operations screen's parts of the one rail (`plan/admin-design-contracts.md`
 * §7.0, Code Owner 2026-10-24; issue #1117).
 *
 * §7.0's table: "Webhooks | Webhooks | Dead-letter queue, then one link per form | form | -".
 *
 * - **Header:** "Webhook operations", a top-level screen, with the active filter count below
 *   `--bp-sidebar`.
 * - **Sections:** the dead-letter queue, then a row per form. The queue is a same-page
 *   anchor onto the heading it already carries (`#qcms-dead-letters-heading`, the id the
 *   post-action focus path uses), and each form row is `/forms/{id}/webhooks`, which is where
 *   that form's configuration lives. That is the ruled list and it is also the screen's own
 *   shape: a global queue, and a way into each form's endpoints.
 * - **Filters:** the form, which narrows the queue.
 * - **Actions:** none. Redelivery is an act on a row of the queue and stays there, where an
 *   operator can see what they are putting back; §3.7 of `plan/admin-ux-audit.md` is the
 *   standing rule that an action like that is never reachable from a navigation surface.
 *
 * ## The form filter narrows the queue, and that is a smaller claim than it sounds
 *
 * `GET /admin/outbox/dead-letters` is global by the API's own design, because "is anything
 * stuck" is an operational question about the deployment rather than about one form. The
 * filter does not change the read: it narrows the rows this render already holds, in the
 * page, so one request still answers the screen either way. What it buys is the operator's
 * NEXT question, "is anything stuck on this one", which until now meant reading a
 * cross-form table looking for a form id.
 *
 * The options are the installation's forms, which this screen has read anyway for the rows
 * below - so the filter costs nothing the Sections did not already cost.
 *
 * A server component.
 */
export function WebhookOpsRail({
  forms,
  filters,
}: {
  /**
   * The installation's forms, or empty when there are none or the read failed.
   *
   * Empty is rendered as no rows and no form options rather than as an empty list: the page
   * is where a failed read is reported, and a rail claiming "no forms" under an alert saying
   * the list could not be read would be asserting what the failed read does not know (the
   * rule issue #513 set on this screen's own body).
   */
  readonly forms: readonly WebhookRailForm[];
  readonly filters: WebhookOpsFilters;
}) {
  const { formId, activeCount } = filters;

  return (
    <RailFrame
      subject={t("ops.area.webhooks.title")}
      title={t("ops.area.webhooks.title")}
      testId="qcms-webhooks-rail"
      {...(activeCount > 0
        ? { count: <RailCount>{activeFilterCount(activeCount)}</RailCount> }
        : {})}
      sections={
        <ul className="qcms-rail__group" data-rail-group="sections">
          <li>
            <a
              href="#qcms-dead-letters-heading"
              className="qcms-rail__link"
              data-rail-item="section:dead-letters"
            >
              {t("ops.deadLetters.heading")}
            </a>
          </li>
          {forms.map((form) => (
            <li key={form.formId}>
              <Link
                href={`/forms/${encodeURIComponent(form.formId)}/webhooks`}
                className="qcms-rail__link"
                data-rail-item={`form:${form.formId}`}
              >
                {form.slug}
              </Link>
            </li>
          ))}
        </ul>
      }
      filters={
        <RailFilters activeCount={activeCount} clearHref="/webhooks">
          <Select
            name="form"
            label={t("ops.area.webhooks.filter.form")}
            defaultValue={formId ?? ""}
            placeholder={t("ops.area.webhooks.filter.formAll")}
            items={[
              { label: t("ops.area.webhooks.filter.formAll"), value: "" },
              ...forms.map((form) => ({ label: form.slug, value: form.formId })),
            ]}
          />
        </RailFilters>
      }
    />
  );
}
