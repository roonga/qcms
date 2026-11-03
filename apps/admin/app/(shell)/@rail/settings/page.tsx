import { SettingsSectionRail } from "@/components/settings-section-rail";
import { requireAdminSession } from "@/lib/server/session";
import { settingsSectionFromParams } from "@/lib/settings-sections";

/* A parallel route keeps the rail outside the content cap and receives params unavailable to layouts. */
export default async function SettingsRail({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminSession();
  return <SettingsSectionRail initial={settingsSectionFromParams(await searchParams)} />;
}
