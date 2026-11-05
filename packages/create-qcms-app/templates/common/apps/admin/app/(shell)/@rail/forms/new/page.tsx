import { RailFrame, RailTree } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { requireAdminSession } from "@/lib/server/session";
import { formsRailItems } from "@/lib/shell/area-rails";

export default async function NewFormRail() {
  await requireAdminSession();
  return (
    <RailFrame
      subject={t("forms.title")}
      testId="qcms-new-form-rail"
      sections={<RailTree items={formsRailItems("new")} />}
    />
  );
}
