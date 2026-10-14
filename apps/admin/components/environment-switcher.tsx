"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Menu } from "@/components/kit";
import { menuClasses } from "@/components/menu-slots";
import { environmentCookie, isNonProd } from "@/lib/environment";
import { t } from "@/lib/i18n/en";

/**
 * The one global environment switcher (ADR-40 Q6, task 065).
 *
 * One control in the shell, selecting the environment for **every** screen, beside the
 * appearance and account menus - the trailing group is where this app puts a control that
 * is on every page. Its mechanism is `AppearanceMenu`'s, and deliberately so: write one
 * long-lived cookie, then let the next server render be correct.
 *
 * ## Why it refreshes, where the appearance menu does not
 *
 * A colour mode is a class the browser can swap; an environment is **which rows a screen
 * is showing**, and those were read on the server before this control existed. So choosing
 * one has to re-read the page: `router.refresh()` re-runs the server components of the
 * current route with the new cookie attached, which is what makes "the switcher sets the
 * environment for every screen" true of the screen the operator is looking at rather than
 * only of the next one they navigate to.
 *
 * The transition is what the control reads from while that happens, so the selection
 * cannot be pressed twice into a half-applied state.
 *
 * ## Why it is a menu of the live set rather than a pair of buttons
 *
 * The environment set is configurable and is a table (ADR-40): `test` and `prod` are what a
 * fresh database has, and an operator may create a third. The options come from
 * `GET /admin/environments` through the shell, so an environment created last week appears
 * here without anybody editing this app.
 *
 * ## It selects, it does not authorise
 *
 * The API validates the name against the live set and refuses one it does not serve, and
 * the authorisation that will gate an environment is ADR-41's access group (tasks 068 and
 * 069). This control therefore offers what the deployment has, and a membership-scoped
 * offer is a later task's, not an omission here.
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
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const choose = (next: string): void => {
    if (next === current) return;
    setCurrent(next);
    document.cookie = environmentCookie(next, secureCookies);
    // The banner and every screen's rows are server-rendered from that cookie, so the
    // page has to be re-read rather than re-styled.
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
      data-nonprod={isNonProd(current) ? "true" : "false"}
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
    </div>
  );
}
