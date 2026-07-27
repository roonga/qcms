import { AreaPlaceholder } from "@/components/area-placeholder";
import { t } from "@/lib/i18n/en";

/** The questions area (task 031's shell placeholder). See `AreaPlaceholder`. */
export default function QuestionsPage() {
  return (
    <AreaPlaceholder title={t("area.questions.title")} pending={t("area.questions.pending")} />
  );
}
