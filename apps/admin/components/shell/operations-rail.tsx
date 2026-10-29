import { RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";

/** Operations' rail: a Header, which the forms table's filters join. */
export function OperationsRail() {
  return (
    <RailFrame
      subject={t("shell.mode.operations.name")}
      title={t("shell.mode.operations.name")}
      testId="qcms-operations-rail"
    />
  );
}
