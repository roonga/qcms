import { t } from "@/lib/i18n/en";

/** The one tag for a suspended membership; its full meaning is read out, not carried by colour. */
export function SuspendedTag() {
  return (
    <span className="qcms-tag qcms-tag--deprecated" data-testid="qcms-suspended-tag">
      {t("membership.suspended.tag")}
      <span className="qcms-visually-hidden">{t("membership.suspended.more")}</span>
    </span>
  );
}
