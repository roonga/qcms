import { RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";

/** My access's rail. One panel, so the Header is the whole of it. */
export function MyAccessRail() {
  return (
    <RailFrame subject={t("access.title")} title={t("access.title")} testId="qcms-my-access-rail" />
  );
}
