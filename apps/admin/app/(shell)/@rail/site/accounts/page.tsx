import { SiteRail } from "@/components/site/site-rail";
import { loadSiteScreen } from "@/components/site/site-screen";
import { readAccountFilters } from "@/lib/site/accounts";

export default async function AccountsRailSlot({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const screen = await loadSiteScreen();
  if (screen.kind === "denied") return null;
  return <SiteRail current="accounts" filters={readAccountFilters(await searchParams)} />;
}
