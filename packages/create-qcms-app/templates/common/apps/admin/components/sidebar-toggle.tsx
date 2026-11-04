"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useAssistant } from "@/lib/agent/panel-context";
import { announce } from "@/lib/announce";
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

/* Update the hiding attribute synchronously before moving focus to the control that reveals the rail
   again. */
export interface SidebarControl {
  readonly setting: SidebarSetting;
  readonly hidden: boolean;
  readonly setSetting: (next: SidebarSetting) => void;
  /* A temporary width hold must never overwrite the operator's persisted sidebar choice. */
  readonly hold: (held: boolean) => void;
}

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

  const setSetting = useCallback(
    (next: SidebarSetting) => {
      setChosen(next);
      document.cookie = sidebarCookie(next, secureCookies);
      document.documentElement.setAttribute(SIDEBAR_ATTRIBUTE, next);
      setFocusId(next === "hidden" ? SHOW_SIDEBAR_ID : HIDE_SIDEBAR_ID);
    },
    [secureCookies],
  );

  // Keep hold's identity stable: changing it would rerun the assistant effect, whose setHeld would schedule
  // another render.
  const hold = useCallback((next: boolean) => {
    setHeld(next);
    if (next) document.documentElement.setAttribute(SIDEBAR_HOLD_ATTRIBUTE, "hidden");
    else document.documentElement.removeAttribute(SIDEBAR_HOLD_ATTRIBUTE);
  }, []);

  const control = useMemo<SidebarControl>(
    () => ({ setting: chosen, hidden: sidebarHidden(chosen, held), setSetting, hold }),
    [chosen, held, hold, setSetting],
  );

  return <SidebarContext.Provider value={control}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarControl {
  return useContext(SidebarContext);
}

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

export function ShowSidebarButton({ filterCount }: { readonly filterCount: number }) {
  const { hidden, setSetting } = useSidebar();
  const assistant = useAssistant();
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
          // Announce through the shell region because this action closes the panel containing its own region.
          if (assistant?.open === true) {
            assistant.close();
            announce(t("agent.sidebar.shown"));
          }
        }}
      >
        {label}
      </button>
    </div>
  );
}
