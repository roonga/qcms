import Link from "next/link";

import { Select } from "@/components/kit";
import { activeFilterCount, RailFilters } from "@/components/rail-filters";
import { RailCount, RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import type { WebhookOpsFilters } from "@/lib/ops/list-filters";
import { OPERATIONS_PATH } from "@/lib/shell/modes";

export interface WebhookRailForm {
  readonly formId: string;
  readonly slug: string;
}

export function WebhookOpsRail({
  forms,
  filters,
}: {
  readonly forms: readonly WebhookRailForm[];
  readonly filters: WebhookOpsFilters;
}) {
  const { formId, activeCount } = filters;

  return (
    <RailFrame
      subject={t("ops.area.webhooks.title")}
      back={{ href: OPERATIONS_PATH, label: t("shell.mode.operations.name") }}
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
                href={`/operations/forms/${encodeURIComponent(form.formId)}/webhooks`}
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
