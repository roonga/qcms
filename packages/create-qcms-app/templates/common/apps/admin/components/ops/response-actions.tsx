"use client";

import { HeadingMarker } from "@/components/agent/heading-marker";
import { Menu } from "@/components/kit";
import { menuClasses } from "@/components/menu-slots";
import { t } from "@/lib/i18n/en";
import { requestErase } from "@/lib/ops/erase-request";

/**
 * The response's one destructive act, kept behind a menu rather than beside its reads. Absent rather
 * than disabled: a caller without the erase cell is not offered a door that can only refuse.
 */
export function ResponseActions({ offered = true }: { readonly offered?: boolean }) {
  if (!offered) return null;
  return (
    <HeadingMarker control="responses.erase">
      <Menu
        triggerLabel={t("ops.detail.moreActions")}
        menuLabel={t("ops.detail.moreActions")}
        classNames={menuClasses("qcms-menu-trigger")}
        onAction={(key) => {
          if (key === "erase") requestErase();
        }}
        items={[
          {
            id: "erase",
            textValue: t("ops.erase.button"),
            label: <span className="qcms-menu__item--danger">{t("ops.erase.button")}</span>,
          },
        ]}
      />
    </HeadingMarker>
  );
}
