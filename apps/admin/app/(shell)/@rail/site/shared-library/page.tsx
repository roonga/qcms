import { SiteRail } from "@/components/site/site-rail";
import { loadSiteScreen, offersSharedLibrary } from "@/components/site/site-screen";

export default async function SharedLibraryRailSlot() {
  const screen = await loadSiteScreen();
  if (screen.kind === "denied") return null;
  return (
    <SiteRail current="sharedLibrary" offersLibrary={await offersSharedLibrary(screen.session)} />
  );
}
