/**
 * Whether the assistant panel is open and how wide, as a cookie the shell layout reads.
 *
 * Pure and client-safe, exactly as `appearance.ts` and `sidebar.ts` are: the layout stamps
 * the state from the cookie, so an open panel renders docked in the first byte of HTML and
 * no frame shows the content column at the wrong width. The conversation itself is never
 * stored anywhere (Q15).
 */

export const PANEL_COOKIE = "qcms-assistant";

/** A year, like the appearance mode: a layout choice is a preference, not a session. */
export const PANEL_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** The element ids the top-bar button's `aria-controls` and the focus return need. */
export const PANEL_ID = "qcms-assistant-panel";
export const ASSISTANT_BUTTON_ID = "qcms-assistant-button";

export const PANEL_MIN_WIDTH = 320;
export const PANEL_MAX_WIDTH = 560;
export const PANEL_DEFAULT_WIDTH = 400;

/** The width menu's three choices, the single-pointer alternative to the edge (2.5.7). */
export const PANEL_WIDTH_CHOICES = [PANEL_MIN_WIDTH, PANEL_DEFAULT_WIDTH, PANEL_MAX_WIDTH] as const;

/** One arrow press on the edge separator. */
export const PANEL_WIDTH_STEP = 40;

export interface PanelState {
  readonly open: boolean;
  readonly width: number;
}

export const CLOSED_PANEL: PanelState = { open: false, width: PANEL_DEFAULT_WIDTH };

export function clampPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return PANEL_DEFAULT_WIDTH;
  return Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(width)));
}

/** `open:400` or `closed:400`; anything else is a closed panel at the default width. */
export function parsePanelState(raw: string | undefined): PanelState {
  if (raw === undefined) return CLOSED_PANEL;
  const [state, width] = raw.split(":");
  return { open: state === "open", width: clampPanelWidth(Number(width)) };
}

export function serializePanelState(state: PanelState): string {
  return `${state.open ? "open" : "closed"}:${String(clampPanelWidth(state.width))}`;
}

export function panelCookie(state: PanelState, secure: boolean): string {
  const attributes = [
    `${PANEL_COOKIE}=${serializePanelState(state)}`,
    "Path=/",
    `Max-Age=${String(PANEL_MAX_AGE_SECONDS)}`,
    "SameSite=Lax",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}
