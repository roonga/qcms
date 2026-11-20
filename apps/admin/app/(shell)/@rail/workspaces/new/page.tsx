import { SiteRail } from "@/components/site/site-rail";
import { loadSiteScreen } from "@/components/site/site-screen";

export default async function NewWorkspaceRailSlot() {
  const screen = await loadSiteScreen();
  if (screen.kind === "denied") return null;
  return <SiteRail current="newWorkspace" />;
}
