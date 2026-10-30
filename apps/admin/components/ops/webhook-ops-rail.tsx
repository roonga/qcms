import Link from "next/link";

import { Select } from "@/components/kit";
import { activeFilterCount, RailFilters } from "@/components/rail-filters";
import { RailCount, RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import type { WebhookOpsFilters } from "@/lib/ops/list-filters";

/** One form, as the rail lists it and as an option on the form filter. */
export interface WebhookRailForm {
  readonly formId: string;
  readonly slug: string;
}

/**
 * The webhook operations rail: the dead-letter queue and a row per form as Sections, and a
 * form filter over the queue (`plan/admin-design-contracts.md` §7.0).
 *
 * Redelivery stays on the queue's own rows: the rail holds no destructive action
 * (`plan/admin-ux-audit.md` §3.7).
 */
export function WebhookOpsRail({
  forms,
  filters,
}: {
  /**
   * The installation's forms, or empty when there are none or the read failed. The page is
   * what reports a failed read.
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
      filterCount={activeCount}
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
