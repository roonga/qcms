"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Menu, MenuItemText } from "@/components/kit";
import type { MenuClassNames } from "@/components/kit";
import { MENU_SURFACE } from "@/components/menu-slots";
import { t } from "@/lib/i18n/en";
import { shellWorkspaceCookie } from "@/lib/shell/context";
import type { WorkspaceChoice } from "@/lib/shell/workspace-context";
import { workspaceSwitchTarget } from "@/lib/shell/workspace-switch";

/* A whole-document load, not a router push: every rail and list is server-rendered from this cookie,
   so a client refresh would leave some of them reading the workspace that was current a moment ago. */

const WORKSPACE_MENU: MenuClassNames = {
  ...MENU_SURFACE,
  trigger: "qcms-wsswitch__trigger",
  popover: "qcms-menu qcms-wsmenu",
  item: "qcms-menu__item qcms-wsmenu__item",
};

function Glyph() {
  return (
    <svg
      className="qcms-wsswitch__glyph"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12l5 5 9-10"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WorkspaceSwitcher({
  choices,
  current,
  secureCookies,
}: {
  readonly choices: readonly WorkspaceChoice[];
  readonly current: WorkspaceChoice;
  readonly secureCookies: boolean;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [announced, setAnnounced] = useState("");

  function choose(next: WorkspaceChoice): void {
    if (next.workspaceId === current.workspaceId) return;
    setAnnounced(t("workspace.switcher.nowIn", { name: next.name }));
    document.cookie = shellWorkspaceCookie(next.workspaceId, secureCookies);
    window.location.assign(
      workspaceSwitchTarget({ pathname, search, workspaceId: next.workspaceId }),
    );
  }

  return (
    <div className="qcms-wsswitch" data-testid="qcms-workspace-switcher" title={current.name}>
      <span className="qcms-wsswitch__sep" aria-hidden="true">
        {"/"}
      </span>
      <Menu
        triggerLabel={t("workspace.switcher.trigger", { name: current.name })}
        trigger={
          <>
            <Glyph />
            <span className="qcms-wsswitch__name">{current.name}</span>
            <svg
              className="qcms-wsswitch__caret"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 6l4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </>
        }
        menuLabel={t("workspace.switcher.legend")}
        classNames={WORKSPACE_MENU}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[current.workspaceId]}
        onAction={(key) => {
          const next = choices.find((choice) => choice.workspaceId === key);
          if (next !== undefined) choose(next);
        }}
        items={choices.map((choice) => ({
          id: choice.workspaceId,
          textValue: choice.name,
          label: (
            <MenuItemText slot="label" className="qcms-wsmenu__row">
              <span className="qcms-wsmenu__check" aria-hidden="true">
                {choice.workspaceId === current.workspaceId && <Check />}
              </span>
              <span>{choice.name}</span>
            </MenuItemText>
          ),
        }))}
      />
      <span className="qcms-wsswitch__divider" aria-hidden="true" />
      <span className="qcms-visually-hidden" role="status" data-testid="qcms-workspace-status">
        {announced}
      </span>
    </div>
  );
}
