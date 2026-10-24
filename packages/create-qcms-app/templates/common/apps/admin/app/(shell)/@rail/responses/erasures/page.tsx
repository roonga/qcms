import { RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The erasure log's rail (§7.0, Code Owner 2026-10-24; issue #1117).
 *
 * §7.0's table: "Erasure log | back to Responses, Erasure log | - | when the log has filters
 * | -". The log has none - `GET /admin/erasures` takes no parameters and this screen offers
 * no narrowing - so the Filters part is absent rather than invented. That is the ruled
 * condition being applied rather than skipped: a filter here would be a new capability riding
 * on a layout change, and the table says "when", not "add one".
 *
 * So the rail is the Header: the way back to Responses, which §7.0 ruling 3 makes the
 * Header's job, and the screen's own name. The content column's "Back to responses" link is
 * gone with it.
 *
 * It carries the 240px track, which is what the acceptance asks of a screen with nothing to
 * list: an operator walking from Responses into the log and back out does not see the table
 * shift sideways under them.
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
