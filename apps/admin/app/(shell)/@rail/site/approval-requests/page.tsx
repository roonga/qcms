import { ApprovalRequestFilters } from "@/components/site/site-filters";
import { SiteRail } from "@/components/site/site-rail";
import { loadSiteScreen, offersSharedLibrary } from "@/components/site/site-screen";
import { readApprovalFilters } from "@/lib/site/approvals";

export default async function ApprovalRequestsRailSlot({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const screen = await loadSiteScreen();
  if (screen.kind === "denied") return null;
  const filters = readApprovalFilters(await searchParams);
  return (
    <SiteRail
      current="approvalRequests"
      offersLibrary={await offersSharedLibrary(screen.session)}
      screenFilters={{
        activeCount: filters.activeCount,
        node: <ApprovalRequestFilters filters={filters} />,
      }}
    />
  );
}
