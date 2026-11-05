import { Select } from "@/components/kit";
import { activeFilterCount, RailFilters } from "@/components/rail-filters";
import { RailCount, RailFrame, RailTree } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import type { WebhookOpsFilters } from "@/lib/ops/list-filters";
import { operationsRailItems } from "@/lib/shell/area-rails";

export interface WebhookRailForm {
  readonly formId: string;
  readonly slug: string;
}

export function WebhookOpsRail({
  forms,
  filters,
  showQueues,
}: {
  readonly forms: readonly WebhookRailForm[];
  readonly filters: WebhookOpsFilters;
  readonly showQueues: boolean;
}) {
  const { formId, activeCount } = filters;

  return (
    <RailFrame
      subject={t("shell.mode.operations.name")}
      testId="qcms-webhooks-rail"
      {...(activeCount > 0
        ? { count: <RailCount>{activeFilterCount(activeCount)}</RailCount> }
        : {})}
      sections={<RailTree items={operationsRailItems("delivery-failures", showQueues)} />}
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
