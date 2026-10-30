/**
 * The operator's Hide sidebar choice (`plan/admin-design-contracts.md` §7.0 ruling 8).
 *
 * Pure and client-safe, exactly as `appearance.ts` is: the root layout stamps the setting
 * on `<html>` from the cookie, the toggles re-stamp it in the browser, and `app/globals.css`
 * reads the attribute. So the rail is already absent in the first byte of HTML and no frame
 * shows a rail the operator put away.
 *
 * ## The operator's setting and the effective state are two values
 *
 * {@link SIDEBAR_ATTRIBUTE} is the operator's own choice and the only one the cookie holds.
 * {@link SIDEBAR_HOLD_ATTRIBUTE} is a temporary hold another surface may take while it needs
 * the width, and it writes no cookie: a hold that edited the setting would leave the rail
 * hidden after whatever took it had gone.
 */

/** Distinct from the appearance and environment cookies, and named for what it holds. */
export const SIDEBAR_COOKIE = "qcms-sidebar";

/** A year, like the appearance mode: a layout choice is a preference, not a session. */
export const SIDEBAR_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type SidebarSetting = "shown" | "hidden";

/** Shown unless the operator said otherwise, which is what a fresh browser gets. */
export const DEFAULT_SIDEBAR: SidebarSetting = "shown";

/** The operator's own choice, on `<html>`. */
export const SIDEBAR_ATTRIBUTE = "data-sidebar";

/** A temporary hold on the width, on `<html>`, carrying `hidden` or nothing at all. */
export const SIDEBAR_HOLD_ATTRIBUTE = "data-sidebar-hold";

/** The toggles' ids, so hiding can move focus to the button that undoes it. */
export const HIDE_SIDEBAR_ID = "qcms-hide-sidebar";
export const SHOW_SIDEBAR_ID = "qcms-show-sidebar";

/** The rail both toggles control, as `aria-controls` names it. */
export const RAIL_REGION_ID = "qcms-rail-region";

export function parseSidebarSetting(raw: string | undefined): SidebarSetting {
  return raw === "hidden" ? "hidden" : DEFAULT_SIDEBAR;
}

/** The `document.cookie` assignment string for an operator's choice. */
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

/** Whether the rail is hidden right now: the operator's setting, or a hold over it. */
export function sidebarHidden(setting: SidebarSetting, held: boolean): boolean {
  return held || setting === "hidden";
}
