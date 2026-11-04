import { RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { requireAdminSession } from "@/lib/server/session";
import { OPERATIONS_PATH } from "@/lib/shell/modes";

/* The erasure-log API accepts no filters. */
export default async function ErasureLogRail() {
  await requireAdminSession();
  return (
    <RailFrame
      subject={t("ops.erasures.title")}
      back={{ href: OPERATIONS_PATH, label: t("shell.mode.operations.name") }}
      title={t("ops.erasures.title")}
      testId="qcms-erasures-rail"
    />
  );
}
