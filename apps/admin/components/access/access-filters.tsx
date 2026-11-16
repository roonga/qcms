import Link from "next/link";

import { Select, TextField } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { roleName } from "@/lib/membership/access-group-form";
import {
  ACCESS_SEARCH_MAX_LENGTH,
  resultRange,
  type AccessFilters,
  type AccessStatus,
} from "@/lib/membership/access-patterns";

/** Search plus role, environment and status filters, for a rail's `RailFilters` form; an empty option list leaves its filter out. */
export function AccessFilterFields({
  filters,
  roles = [],
  environments = [],
  statuses = [],
}: {
  readonly filters: AccessFilters;
  readonly roles?: readonly string[];
  readonly environments?: readonly string[];
  readonly statuses?: readonly AccessStatus[];
}) {
  const any = { label: t("access.filter.any"), value: "" };
  return (
    <>
      <TextField
        name="q"
        type="text"
        label={t("access.filter.search")}
        placeholder={t("access.filter.searchPlaceholder")}
        defaultValue={filters.search}
        maxLength={ACCESS_SEARCH_MAX_LENGTH}
      />
      {roles.length > 0 && (
        <Select
          name="role"
          label={t("access.filter.role")}
          defaultValue={filters.role ?? ""}
          placeholder={any.label}
          items={[any, ...roles.map((role) => ({ label: roleName(role), value: role }))]}
        />
      )}
      {environments.length > 0 && (
        <Select
          name="environment"
          label={t("access.filter.environment")}
          defaultValue={filters.environment ?? ""}
          placeholder={any.label}
          items={[any, ...environments.map((environment) => ({ label: environment, value: environment }))]}
        />
      )}
      {statuses.length > 0 && (
        <Select
          name="status"
          label={t("access.filter.status")}
          defaultValue={filters.status ?? ""}
          placeholder={any.label}
          items={[
            any,
            ...statuses.map((status) => ({ label: t(`access.status.${status}`), value: status })),
          ]}
        />
      )}
    </>
  );
}

/** "1 to 25 of 1,000" with Previous and Next; a page that does not exist is shown but not linked. */
export function ResultPager({
  page,
  pageSize,
  total,
  locale,
  pageHref,
}: {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly locale: string;
  readonly pageHref: (page: number) => string;
}) {
  const range = resultRange(page, pageSize, total);
  const number = new Intl.NumberFormat(locale);
  return (
    <nav aria-label={t("access.results.label")} className="flex flex-wrap items-center gap-2">
      <p className="text-sm text-(--color-text-muted)" aria-live="polite">
        {range.total === 0
          ? t("access.results.none")
          : t("access.results.range", {
              first: number.format(range.first),
              last: number.format(range.last),
              total: number.format(range.total),
            })}
      </p>
      <PageLink target={range.previous} pageHref={pageHref} label={t("access.results.previous")} />
      <PageLink target={range.next} pageHref={pageHref} label={t("access.results.next")} />
    </nav>
  );
}

function PageLink({
  target,
  pageHref,
  label,
}: {
  readonly target: number | undefined;
  readonly pageHref: (page: number) => string;
  readonly label: string;
}) {
  if (target === undefined) {
    return (
      <span aria-disabled="true" className="text-sm text-(--color-text-muted)">
        {label}
      </span>
    );
  }
  return (
    <Link href={pageHref(target)} className="qcms-text-link text-sm">
      {label}
    </Link>
  );
}
