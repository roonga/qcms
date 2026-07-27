import { AreaPlaceholder } from "@/components/area-placeholder";
import { t } from "@/lib/i18n/en";

/** The forms area (task 031's shell placeholder). See `AreaPlaceholder`. */
export default function FormsPage() {
  return <AreaPlaceholder title={t("area.forms.title")} pending={t("area.forms.pending")} />;
}
