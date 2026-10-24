import { MessageScreen } from "@/components/message-screen";
import { t } from "@/lib/i18n/en";
import { portalBrand } from "@/lib/server/theme";

export default function Home() {
  return <MessageScreen tone="neutral" title={portalBrand().name} body={t("home.body")} />;
}
