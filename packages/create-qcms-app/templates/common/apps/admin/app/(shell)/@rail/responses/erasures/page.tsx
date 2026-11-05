import { RailFrame, RailTree } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { navigableCapabilities, shellAccess } from "@/lib/server/shell";
import { requireAdminSession } from "@/lib/server/session";
import { operationsRailItems } from "@/lib/shell/area-rails";

export default async function ErasureLogRail() {
  const session = await requireAdminSession();
  const access = await shellAccess(session);
  return (
    <RailFrame
      subject={t("shell.mode.operations.name")}
      testId="qcms-erasures-rail"
      sections={
        <RailTree
          items={operationsRailItems(
            "erasure-log",
            navigableCapabilities(access).siteConfiguration,
          )}
        />
      }
    />
  );
}
