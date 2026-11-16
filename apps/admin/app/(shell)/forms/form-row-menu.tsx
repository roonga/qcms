"use client";

import { Menu } from "@/components/kit";
import { menuClasses } from "@/components/menu-slots";
import { t } from "@/lib/i18n/en";
import { formContextHref } from "@/lib/ops/form-contexts";
import { builderPath } from "@/lib/shell/modes";

export function FormRowMenu({
  formId,
  name,
  canOperate,
  canBuild = false,
}: {
  readonly formId: string;
  readonly name: string;
  readonly canOperate: boolean;
  /** The agent flag is on and the caller may edit this form's draft. */
  readonly canBuild?: boolean;
}) {
  const label = t("forms.rowActions", { name });
  const form = `/forms/${encodeURIComponent(formId)}`;

  return (
    <Menu
      triggerLabel={label}
      trigger={
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="12" cy="19" r="1.7" />
        </svg>
      }
      menuLabel={label}
      placement="bottom"
      classNames={menuClasses("qcms-iconbutton qcms-iconbutton--sm qcms-rowmenu-trigger")}
      items={[
        { id: "builder", label: t("forms.tab.builder"), href: form },
        ...(canBuild
          ? [{ id: "agent-builder", label: t("forms.menu.agentBuilder"), href: builderPath(formId) }]
          : []),
        { id: "preview", label: t("forms.tab.preview"), href: `${form}/preview` },
        ...(canOperate
          ? [
              {
                id: "links",
                label: t("forms.tab.links"),
                href: formContextHref(formId, "links"),
              },
            ]
          : []),
      ]}
    />
  );
}
