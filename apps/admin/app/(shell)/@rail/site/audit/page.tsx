import { SiteAuditFilters } from "@/components/site/site-filters";
import { SiteRail } from "@/components/site/site-rail";
import { loadSiteScreen } from "@/components/site/site-screen";
import { readSiteAuditFilters } from "@/lib/site/audit";

export default async function SiteAuditRailSlot({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const screen = await loadSiteScreen();
  if (screen.kind === "denied") return null;
  const filters = readSiteAuditFilters(await searchParams);
  return (
    <SiteRail
      current="siteAudit"
      screenFilters={{
        activeCount: filters.activeCount,
        node: <SiteAuditFilters filters={filters} />,
      }}
    />
  );
}
