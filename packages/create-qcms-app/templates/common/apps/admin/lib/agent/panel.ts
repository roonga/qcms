/** Persist only layout preferences so SSR can render the dock without a width flash. Conversations stay in memory. */

export const PANEL_COOKIE = "qcms-assistant";

export const PANEL_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export const PANEL_ID = "qcms-assistant-panel";
export const ASSISTANT_BUTTON_ID = "qcms-assistant-button";

export const PANEL_MIN_WIDTH = 320;
export const PANEL_MAX_WIDTH = 560;
export const PANEL_DEFAULT_WIDTH = 400;

export const PANEL_WIDTH_CHOICES = [PANEL_MIN_WIDTH, PANEL_DEFAULT_WIDTH, PANEL_MAX_WIDTH] as const;

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
