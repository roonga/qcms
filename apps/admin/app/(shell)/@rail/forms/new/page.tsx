import { RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The form creation screen's rail: a Header and nothing else (§7.0 ruling 6). A screen with
 * nothing to list still takes the frame, so the content column's left edge does not shift.
 */
export default async function NewFormRail() {
  await requireAdminSession();
  return (
    <RailFrame
      subject={t("forms.create.title")}
      back={{ href: "/forms", label: t("forms.title") }}
      title={t("forms.create.title")}
      testId="qcms-new-form-rail"
    />
  );
}
