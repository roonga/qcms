import { RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { requireAdminSession } from "@/lib/server/session";

export default async function NewFormRail() {
  await requireAdminSession();
  return <RailFrame subject={t("forms.title")} testId="qcms-new-form-rail" />;
}
