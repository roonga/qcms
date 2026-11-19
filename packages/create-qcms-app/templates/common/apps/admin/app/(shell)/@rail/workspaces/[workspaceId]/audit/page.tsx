import { AuditRailFilters } from "@/components/membership/audit-rail-filters";
import { WorkspacesRailSlot } from "@/components/membership/workspaces-rail-slot";
import { auditActors, readAuditFilters } from "@/lib/membership/audit-filters";
import { workspaceSectionHref } from "@/lib/membership/sections";
import { readAuditPage } from "@/lib/server/membership";
import { requireAdminSession } from "@/lib/server/session";

export default async function WorkspaceSectionRailPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ workspaceId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const session = await requireAdminSession();
  const filters = readAuditFilters(await searchParams);
  // The screen reads the same page in the same request, so the Person filter offers the accounts
  // the rows beside it actually carry.
  const audit = await readAuditPage(session, workspaceId, filters.kind, filters.page);
  return (
    <WorkspacesRailSlot
      selected={{ workspaceId, section: "audit" }}
      filters={
        <AuditRailFilters
          filters={filters}
          actors={auditActors(audit.ok ? audit.data.rows : [])}
          clearHref={workspaceSectionHref(workspaceId, "audit")}
        />
      }
    />
  );
}
