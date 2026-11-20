import { Select } from "@/components/kit";
import { RailFilters } from "@/components/rail-filters";
import { t } from "@/lib/i18n/en";
import {
  AUDIT_FILTER_KINDS,
  AUDIT_FILTER_KIND_LABELS,
  auditActorChoices,
  type AuditFilters,
} from "@/lib/membership/audit-filters";
import type { AuditActor } from "@/lib/membership/types";

/** The audit's own filters, in the rail's Filters form: the act the API narrows on, then the person. */
export function AuditRailFilters({
  filters,
  actors,
  clearHref,
}: {
  readonly filters: AuditFilters;
  readonly actors: readonly AuditActor[];
  readonly clearHref: string;
}) {
  const anyone = { label: t("membership.audit.filter.personAny"), value: "" };
  const people = auditActorChoices(actors, filters.actor);

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
          name="actor"
          label={t("membership.audit.filter.person")}
          defaultValue={filters.actor ?? ""}
          placeholder={anyone.label}
          items={[
            anyone,
            ...people.map((person) => ({
              label:
                person.actorEmail ?? t("membership.audit.unknownActor", { actor: person.actor }),
              value: person.actor,
            })),
          ]}
        />
      )}
    </RailFilters>
  );
}
