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
import { t } from "@/lib/i18n/en";
import {
  isRailShortcut,
  RAIL_REGION_ID,
  RAIL_TOGGLE_ID,
  SIDEBAR_ATTRIBUTE,
  SIDEBAR_HOLD_ATTRIBUTE,
  SIDEBAR_QUERY,
  sidebarCookie,
  sidebarHidden,
  type SidebarSetting,
} from "@/lib/sidebar";

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

function typingOutsideRail(): boolean {
  const active = document.activeElement;
  const typing =
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement ||
    (active instanceof HTMLElement && active.isContentEditable);
  return typing && document.getElementById(RAIL_REGION_ID)?.contains(active) !== true;
}

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

  const setSetting = useCallback(
    (next: SidebarSetting) => {
      // Collapsing hides the rail's contents, so focus inside them would be lost.
      if (next === "hidden") {
        const rail = document.getElementById(RAIL_REGION_ID);
        if (rail?.contains(document.activeElement) === true) {
          document.getElementById(RAIL_TOGGLE_ID)?.focus();
        }
      }
      setChosen(next);
      document.documentElement.setAttribute(SIDEBAR_ATTRIBUTE, next);
      try {
        document.cookie = sidebarCookie(next, secureCookies);
      } catch {
        // Without the cookie the choice lasts until the next full load.
      }
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

/** The top bar's one rail control, also pressed by Alt+Shift+S. */
export function RailToggle() {
  const { hidden, setSetting } = useSidebar();
  const assistant = useAssistant();

  const toggle = useCallback(() => {
    if (!hidden) {
      setSetting("hidden");
      return;
    }
    setSetting("shown");
    // A rail held collapsed by the open assistant returns only once the assistant closes.
    if (assistant?.open === true) {
      assistant.close();
      announce(t("agent.sidebar.shown"));
    }
  }, [assistant, hidden, setSetting]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isRailShortcut(event) || typingOutsideRail()) return;
      // The toggle is hidden below the breakpoint, so the chord must not persist a choice nobody can see.
      if (!window.matchMedia(SIDEBAR_QUERY).matches) return;
      event.preventDefault();
      toggle();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [toggle]);

  const label = hidden ? t("rail.expand") : t("rail.collapse");
  return (
    <button
      id={RAIL_TOGGLE_ID}
      type="button"
      className="qcms-railtoggle"
      data-testid="qcms-rail-toggle"
      aria-label={label}
      aria-controls={RAIL_REGION_ID}
      aria-expanded={!hidden}
      aria-keyshortcuts="Alt+Shift+S"
      title={t("rail.toggle.title", { action: label })}
      onClick={toggle}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect
          x="2.75"
          y="3.75"
          width="14.5"
          height="12.5"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M7.5 3.75v12.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </button>
  );
}
