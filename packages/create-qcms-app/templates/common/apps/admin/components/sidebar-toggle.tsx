"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { t, tPlural } from "@/lib/i18n/en";
import {
  HIDE_SIDEBAR_ID,
  RAIL_REGION_ID,
  SHOW_SIDEBAR_ID,
  SIDEBAR_ATTRIBUTE,
  SIDEBAR_HOLD_ATTRIBUTE,
  sidebarCookie,
  sidebarHidden,
  type SidebarSetting,
} from "@/lib/sidebar";

/**
 * The Hide sidebar pair, and the state they share
 * (`plan/admin-design-contracts.md` §7.0 ruling 8).
 *
 * The two buttons sit in different subtrees - one in the rail, one above the content column
 * - so the state is a context in the shell rather than a prop either could pass the other.
 *
 * What actually hides the rail is the attribute on `<html>`, which the server already
 * stamped: the CSS reads it, so the state here is for the labels, for `aria-expanded` and
 * for the hold a later surface takes. `setSetting` writes the attribute synchronously
 * rather than from an effect, so the rail's display has changed by the time focus moves to
 * the button that undoes it.
 */
export interface SidebarControl {
  /** The operator's own choice, which is the only thing the cookie holds. */
  readonly setting: SidebarSetting;
  /** Whether the rail is hidden right now, the operator's choice or a hold over it. */
  readonly hidden: boolean;
  readonly setSetting: (next: SidebarSetting) => void;
  /** Take or release a temporary hold on the width, writing no cookie. */
  readonly hold: (held: boolean) => void;
}

/** A rail rendered outside the shell gets the shown state and inert controls. */
const INERT: SidebarControl = {
  setting: "shown",
  hidden: false,
  setSetting: () => undefined,
  hold: () => undefined,
};

const SidebarContext = createContext<SidebarControl>(INERT);

export function SidebarProvider({
  setting,
  secureCookies,
  children,
}: {
  readonly setting: SidebarSetting;
  readonly secureCookies: boolean;
  readonly children: ReactNode;
}) {
  const [chosen, setChosen] = useState(setting);
  const [held, setHeld] = useState(false);
  const [focusId, setFocusId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (focusId === undefined) return;
    document.getElementById(focusId)?.focus();
    setFocusId(undefined);
  }, [focusId]);

  const control: SidebarControl = {
    setting: chosen,
    hidden: sidebarHidden(chosen, held),
    setSetting: (next) => {
      setChosen(next);
      document.cookie = sidebarCookie(next, secureCookies);
      document.documentElement.setAttribute(SIDEBAR_ATTRIBUTE, next);
      setFocusId(next === "hidden" ? SHOW_SIDEBAR_ID : HIDE_SIDEBAR_ID);
    },
    hold: (next) => {
      setHeld(next);
      if (next) document.documentElement.setAttribute(SIDEBAR_HOLD_ATTRIBUTE, "hidden");
      else document.documentElement.removeAttribute(SIDEBAR_HOLD_ATTRIBUTE);
    },
  };

  return <SidebarContext.Provider value={control}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarControl {
  return useContext(SidebarContext);
}

/** The rail's own toggle. Hidden below `--bp-sidebar`, where the disclosure governs. */
export function HideSidebarButton() {
  const { hidden, setSetting } = useSidebar();
  return (
    <div className="qcms-rail__hide">
      <button
        id={HIDE_SIDEBAR_ID}
        type="button"
        className="qcms-railtoggle"
        data-testid="qcms-hide-sidebar"
        aria-controls={RAIL_REGION_ID}
        aria-expanded={!hidden}
        onClick={() => {
          setSetting("hidden");
        }}
      >
        {t("rail.hide")}
      </button>
    </div>
  );
}

/**
 * The way back, above the content column, carrying the count of filters set in the rail
 * nobody can see.
 */
export function ShowSidebarButton({ filterCount }: { readonly filterCount: number }) {
  const { hidden, setSetting } = useSidebar();
  const label =
    filterCount > 0
      ? t("rail.show.filtered", {
          filters: tPlural("rail.show.oneFilter", "rail.show.filters", filterCount),
        })
      : t("rail.show");
  return (
    <div className="qcms-rail__show">
      <button
        id={SHOW_SIDEBAR_ID}
        type="button"
        className="qcms-railtoggle"
        data-testid="qcms-show-sidebar"
        aria-controls={RAIL_REGION_ID}
        aria-expanded={!hidden}
        onClick={() => {
          setSetting("shown");
        }}
      >
        {label}
      </button>
    </div>
  );
}
