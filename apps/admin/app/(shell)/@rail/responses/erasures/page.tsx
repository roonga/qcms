import { RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The erasure log's rail: a Header and nothing else.
 *
 * No Filters part: §7.0's table gives this screen one only when the log has filters, and
 * `GET /admin/erasures` takes no parameters.
 */
export default async function ErasureLogRail() {
  await requireAdminSession();
  return (
    <RailFrame
      subject={t("ops.erasures.title")}
      back={{ href: "/responses", label: t("ops.area.responses.title") }}
      title={t("ops.erasures.title")}
      testId="qcms-erasures-rail"
    />
  );
}
