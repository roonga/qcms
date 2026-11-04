"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Menu } from "@/components/kit";
import { menuClasses } from "@/components/menu-slots";
import { environmentCookie, environmentKind } from "@/lib/environment";
import { t } from "@/lib/i18n/en";

/* Refresh server-rendered rows after switching; changing a cookie alone leaves the displayed environment
   stale. */

const SELECTED_MARK = "✓";

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
    <div
      className="qcms-envswitch"
      data-testid="qcms-environment-switcher"
      data-environment={current}
      data-kind={environmentKind(current)}
      data-pending={isPending ? "true" : "false"}
    >
      <Menu
        triggerLabel={t("environment.trigger", { environment: current })}
        trigger={
          <span className="qcms-envswitch__name" aria-hidden="true">
            {current}
          </span>
        }
        menuLabel={t("environment.legend")}
        classNames={menuClasses("qcms-envtrigger")}
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
            <>
              <span className="qcms-menu__check" aria-hidden="true">
                {environment === current ? SELECTED_MARK : ""}
              </span>
              {environment}
            </>
          ),
        }))}
      />
      <span className="qcms-visually-hidden" role="status" data-testid="qcms-environment-status">
        {announced}
      </span>
    </div>
  );
}
