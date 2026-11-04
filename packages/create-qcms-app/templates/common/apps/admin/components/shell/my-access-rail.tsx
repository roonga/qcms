import { RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";

export function MyAccessRail() {
  return (
    <RailFrame subject={t("access.title")} title={t("access.title")} testId="qcms-my-access-rail" />
  );
}
