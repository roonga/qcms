import { Select } from "@/components/kit";
import { RailFilters } from "@/components/rail-filters";
import { t } from "@/lib/i18n/en";
import {
  AUDIT_FILTER_KINDS,
  AUDIT_FILTER_KIND_LABELS,
  type AuditFilters,
} from "@/lib/membership/audit-filters";

/** The audit's own filters, in the rail's Filters form: the act the API narrows on, then the person. */
export function AuditRailFilters({
  filters,
  actors,
  clearHref,
}: {
  readonly filters: AuditFilters;
  readonly actors: readonly string[];
  readonly clearHref: string;
}) {
  const anyone = { label: t("membership.audit.filter.personAny"), value: "" };
  // Keep a chosen person offered even when this page carries no row of theirs, so Apply does not
  // silently drop the filter the address asked for.
  const people = [...new Set(filters.person === undefined ? actors : [...actors, filters.person])];

  return (
    <RailFilters activeCount={filters.activeCount} clearHref={clearHref}>
      <Select
        name="kind"
        label={t("membership.audit.filter.kind")}
        defaultValue={filters.kind ?? ""}
        placeholder={t("membership.audit.filter.kindAll")}
        items={[
          { label: t("membership.audit.filter.kindAll"), value: "" },
          ...AUDIT_FILTER_KINDS.map((kind) => ({
            label: t(AUDIT_FILTER_KIND_LABELS[kind]),
            value: kind,
          })),
        ]}
      />
      {people.length > 0 && (
        <Select
          name="person"
          label={t("membership.audit.filter.person")}
          defaultValue={filters.person ?? ""}
          placeholder={anyone.label}
          items={[anyone, ...people.map((person) => ({ label: person, value: person }))]}
        />
      )}
      <p className="text-xs text-(--color-text-muted)">{t("membership.audit.filter.scope")}</p>
    </RailFilters>
  );
}
