import { AreaPlaceholder } from "@/components/area-placeholder";
import { t } from "@/lib/i18n/en";

/** The responses area (task 031's shell placeholder). See `AreaPlaceholder`. */
export default function ResponsesPage() {
  return (
    <AreaPlaceholder title={t("area.responses.title")} pending={t("area.responses.pending")} />
  );
}
