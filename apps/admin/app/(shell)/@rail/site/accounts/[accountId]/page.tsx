import { SiteRail } from "@/components/site/site-rail";
import { loadSiteScreen } from "@/components/site/site-screen";
import { readAccount } from "@/lib/server/accounts";

export default async function AccountRailSlot({
  params,
}: {
  readonly params: Promise<{ accountId: string }>;
}) {
  const screen = await loadSiteScreen();
  if (screen.kind === "denied") return null;
  const { accountId } = await params;
  const account = await readAccount(screen.session, accountId);
  return <SiteRail current="accounts" {...(account.ok ? { account: account.data.name } : {})} />;
}
