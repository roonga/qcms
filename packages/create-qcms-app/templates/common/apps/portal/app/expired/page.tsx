import { MessageScreen } from "@/components/message-screen";
import { t } from "@/lib/i18n/en";

export default function ExpiredPage() {
  return <MessageScreen tone="error" title={t("expired.title")} body={t("expired.body")} />;
}
