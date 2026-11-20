import { Select } from "@/components/kit";
import { RailFilters } from "@/components/rail-filters";
import { t } from "@/lib/i18n/en";
import { APPROVAL_STATUSES } from "@/lib/membership/types";
import {
  APPROVAL_REQUESTS_PATH,
  approvalStatusLabel,
  type ApprovalFilters,
} from "@/lib/site/approvals";
import {
  SITE_AUDIT_KINDS,
  SITE_AUDIT_PATH,
  siteAuditKindLabel,
  type SiteAuditFilters as AuditFilters,
} from "@/lib/site/audit";

/** Pending is the list's default, so "Any status" is its own value rather than an empty one. */
export function ApprovalRequestFilters({ filters }: { readonly filters: ApprovalFilters }) {
  return (
    <RailFilters activeCount={filters.activeCount} clearHref={APPROVAL_REQUESTS_PATH}>
      <Select
        name="status"
        label={t("access.filter.status")}
        defaultValue={filters.status ?? "all"}
        items={[
          ...APPROVAL_STATUSES.map((value) => ({ label: approvalStatusLabel(value), value })),
          { label: t("access.filter.any"), value: "all" },
        ]}
      />
      <Select
        name="scope"
        label={t("site.requests.filter.scope")}
        defaultValue={filters.scope ?? ""}
        placeholder={t("access.filter.any")}
        items={[
          { label: t("access.filter.any"), value: "" },
          { label: t("site.requests.scope.site"), value: "site" },
          { label: t("site.requests.scope.workspace"), value: "workspace" },
        ]}
      />
    </RailFilters>
  );
}

export function SiteAuditFilters({ filters }: { readonly filters: AuditFilters }) {
  return (
    <RailFilters activeCount={filters.activeCount} clearHref={SITE_AUDIT_PATH}>
      <Select
        name="kind"
        label={t("membership.audit.filter.kind")}
        defaultValue={filters.kind ?? ""}
        placeholder={t("membership.audit.filter.kindAll")}
        items={[
          { label: t("membership.audit.filter.kindAll"), value: "" },
          ...SITE_AUDIT_KINDS.map((value) => ({ label: siteAuditKindLabel(value), value })),
        ]}
      />
    </RailFilters>
  );
}
