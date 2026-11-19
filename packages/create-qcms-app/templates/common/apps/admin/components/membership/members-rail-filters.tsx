import { Select, TextField } from "@/components/kit";
import { RailFilters } from "@/components/rail-filters";
import { t } from "@/lib/i18n/en";
import { ACCESS_SEARCH_MAX_LENGTH } from "@/lib/membership/access-patterns";
import { MEMBER_STATUSES, type MemberFilters } from "@/lib/membership/people";

export function MembersRailFilters({
  filters,
  groups,
  clearHref,
}: {
  readonly filters: MemberFilters;
  readonly groups: readonly { readonly teamId: string; readonly name: string }[];
  readonly clearHref: string;
}) {
  const any = { label: t("access.filter.any"), value: "" };
  return (
    <RailFilters activeCount={filters.activeCount} clearHref={clearHref}>
      <TextField
        name="q"
        type="text"
        label={t("access.filter.search")}
        placeholder={t("access.filter.searchPlaceholder")}
        defaultValue={filters.search}
        maxLength={ACCESS_SEARCH_MAX_LENGTH}
      />
      {groups.length > 0 && (
        <Select
          name="group"
          label={t("membership.members.columnGroups")}
          defaultValue={filters.group ?? ""}
          placeholder={any.label}
          items={[any, ...groups.map((group) => ({ label: group.name, value: group.teamId }))]}
        />
      )}
      <Select
        name="administrator"
        label={t("membership.members.columnAdministrator")}
        defaultValue={filters.administrator ?? ""}
        placeholder={any.label}
        items={[
          any,
          { label: t("membership.members.administratorYes"), value: "yes" },
          { label: t("membership.members.administratorNo"), value: "no" },
        ]}
      />
      <Select
        name="status"
        label={t("access.filter.status")}
        defaultValue={filters.status ?? ""}
        placeholder={any.label}
        items={[
          any,
          ...MEMBER_STATUSES.map((status) => ({
            label: t(`access.status.${status}`),
            value: status,
          })),
        ]}
      />
    </RailFilters>
  );
}
