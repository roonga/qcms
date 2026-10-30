"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Menu } from "@/components/kit";
import { menuClasses } from "@/components/menu-slots";
import { environmentCookie, environmentKind } from "@/lib/environment";
import { t } from "@/lib/i18n/en";

/**
 * The explicit environment selector, and the indicator it doubles as (ADR-40 Q6).
 *
 * One control, in the Operations header: it writes the long-lived cookie and then lets the
 * next server render be correct. `router.refresh()` is what makes the selection true of
 * the screen the operator is looking at rather than only of the next one, because an
 * environment is which rows a screen read on the server.
 *
 * It selects and does not authorise: the API validates the name against the live set, and
 * `GET /admin/environments` is already narrowed to the environments the caller holds.
 */

/** The check glyph on the chosen row. U+2713, as the appearance menu uses. */
const SELECTED_MARK = "✓";

export function EnvironmentSwitcher({
  environments,
  selected,
  secureCookies,
}: {
  /** The live set, in canonical order. */
  readonly environments: readonly string[];
  /** The operator's current selection, always one of {@link environments}. */
  readonly selected: string;
  readonly secureCookies: boolean;
}) {
  const [current, setCurrent] = useState(selected);
  // When the selection moves without this control being used - another tab switched and
  // this tab was re-read on its return - the shown name follows it. Adjusted during render
  // rather than in an effect, so no frame shows the stale name.
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

  // `data-pending` is on the wrapper while the refresh is in flight, which is what a
  // browser spec waits on rather than on a timeout.
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
              {/* Never the mark alone (WCAG 1.4.1): `aria-checked` is what a screen reader
                  hears and the span keeps its width either way, so choosing a row moves no
                  text. */}
              <span className="qcms-menu__check" aria-hidden="true">
                {environment === current ? SELECTED_MARK : ""}
              </span>
              {environment}
            </>
          ),
        }))}
      />
      {/* Empty on first render: the chip beside it already names the environment, and a
          region that announced on every navigation is one people learn to ignore. */}
      <span className="qcms-visually-hidden" role="status" data-testid="qcms-environment-status">
        {announced}
      </span>
    </div>
  );
}
