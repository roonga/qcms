/** Persist only the operator choice for correct SSR. Temporary width holds must not write that cookie or navigation would leave the rail hidden. */

export const SIDEBAR_COOKIE = "qcms-sidebar";

export const SIDEBAR_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type SidebarSetting = "shown" | "hidden";

export const DEFAULT_SIDEBAR: SidebarSetting = "shown";

export const SIDEBAR_ATTRIBUTE = "data-sidebar";

export const SIDEBAR_HOLD_ATTRIBUTE = "data-sidebar-hold";

export const RAIL_TOGGLE_ID = "qcms-rail-toggle";

export const RAIL_REGION_ID = "qcms-rail-region";

export function parseSidebarSetting(raw: string | undefined): SidebarSetting {
  return raw === "hidden" ? "hidden" : DEFAULT_SIDEBAR;
}

export function sidebarCookie(setting: SidebarSetting, secure: boolean): string {
  const attributes = [
    `${SIDEBAR_COOKIE}=${setting}`,
    "Path=/",
    `Max-Age=${SIDEBAR_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function sidebarHidden(setting: SidebarSetting, held: boolean): boolean {
  return held || setting === "hidden";
}

export function nextSidebarSetting(setting: SidebarSetting): SidebarSetting {
  return setting === "hidden" ? "shown" : "hidden";
}

export interface ShortcutFacts {
  readonly key: string;
  readonly code: string;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

/** Alt+Shift+S, read from the physical key because macOS turns Option+Shift+S into another character. */
export function isRailShortcut(event: ShortcutFacts): boolean {
  if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return false;
  return event.code === "KeyS" || event.key.toLowerCase() === "s";
}
