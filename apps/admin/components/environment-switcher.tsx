"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { EnvironmentChip, EnvironmentSlot } from "@/components/environment-chip";
import { Menu, MenuItemText } from "@/components/kit";
import type { MenuClassNames } from "@/components/kit";
import { MENU_SURFACE } from "@/components/menu-slots";
import { environmentCookie, environmentKind } from "@/lib/environment";
import { t } from "@/lib/i18n/en";

/* Refresh server-rendered rows after switching; changing a cookie alone leaves the displayed environment
   stale. */

const ENVIRONMENT_MENU: MenuClassNames = {
  ...MENU_SURFACE,
  trigger: "qcms-envtrigger",
  popover: "qcms-menu qcms-envmenu",
  item: "qcms-menu__item qcms-envmenu__item",
};

/** Production is always its own colour; the others take the tints 1 to 6 in list order, then repeat. */
function tintSlot(environments: readonly string[], environment: string): number | undefined {
  if (environmentKind(environment) === "prod") return undefined;
  const others = environments.filter((candidate) => environmentKind(candidate) !== "prod");
  const index = others.indexOf(environment);
  return index < 0 ? undefined : 1 + (index % 6);
}

export function EnvironmentSwitcher({
  environments,
  selected,
  secureCookies,
}: {
  readonly environments: readonly string[];
  readonly selected: string;
  readonly secureCookies: boolean;
}) {
  const [current, setCurrent] = useState(selected);
  const [rendered, setRendered] = useState(selected);
  const [announced, setAnnounced] = useState("");
  if (selected !== rendered) {
    setRendered(selected);
    setCurrent(selected);
    setAnnounced(t("environment.nowWorking", { environment: selected }));
  }
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const choose = (next: string): void => {
    if (next === current) return;
    setCurrent(next);
    setAnnounced(t("environment.nowWorking", { environment: next }));
    document.cookie = environmentCookie(next, secureCookies);
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <EnvironmentSlot
      environment={current}
      pending={isPending}
      slot={tintSlot(environments, current)}
    >
      <Menu
        triggerLabel={t("environment.trigger", { environment: current })}
        trigger={
          <>
            <EnvironmentChip environment={current} slot={tintSlot(environments, current)} />
            <svg
              className="qcms-envtrigger__caret"
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
        menuLabel={t("environment.legend")}
        classNames={ENVIRONMENT_MENU}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[current]}
        onAction={(key) => {
          const next = environments.find((candidate) => candidate === key);
          if (next !== undefined) choose(next);
        }}
        items={environments.map((environment) => ({
          id: environment,
          textValue: environment,
          label: (
            <MenuItemText slot="label" className="qcms-envmenu__row">
              <span className="qcms-envmenu__check" aria-hidden="true">
                {environment === current && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M5 12l5 5 9-10"
                      stroke="currentColor"
                      strokeWidth="2.25"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <EnvironmentChip
                environment={environment}
                slot={tintSlot(environments, environment)}
              />
            </MenuItemText>
          ),
        }))}
      />
      <span className="qcms-visually-hidden" role="status" data-testid="qcms-environment-status">
        {announced}
      </span>
    </EnvironmentSlot>
  );
}
