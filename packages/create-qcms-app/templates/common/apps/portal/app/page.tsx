import { MessageScreen } from "@/components/message-screen";
import { t } from "@/lib/i18n/en";
import { portalBrand } from "@/lib/server/theme";

/**
 * Portal root. Respondents always arrive at a form entry (`/f/:slug`) or a secure
 * link (`/l/:token`); the bare root is only a neutral landing.
 *
 * Its heading is the deployment's brand name (task 053, folding issue #25), not the
 * `QCMS` literal it used to be: this page is what someone sees who typed the host
 * name without a link, and the name they should see there is the operator's.
 */
export default function Home() {
  return <MessageScreen tone="neutral" title={portalBrand().name} body={t("home.body")} />;
}
