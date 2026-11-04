import { RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { requireAdminSession } from "@/lib/server/session";

export default async function ResponsesRailSlot() {
  await requireAdminSession();
  return (
    <RailFrame
      subject={t("shell.mode.operations.name")}
      title={t("shell.mode.operations.name")}
      testId="qcms-operations-rail"
    />
  );
}
