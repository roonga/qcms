import { MessageScreen } from "@/components/message-screen";
import { t } from "@/lib/i18n/en";

/**
 * Expired session (retention sweep). A typed-reject page: explanation only. A
 * start-again affordance is added by the wiring phase when the form is still open.
 */
export default function ExpiredPage() {
  return <MessageScreen tone="error" title={t("expired.title")} body={t("expired.body")} />;
}
