import { AreaPlaceholder } from "@/components/area-placeholder";
import { t } from "@/lib/i18n/en";

/** The webhooks area (task 031's shell placeholder). See `AreaPlaceholder`. */
export default function WebhooksPage() {
  return <AreaPlaceholder title={t("area.webhooks.title")} pending={t("area.webhooks.pending")} />;
}
