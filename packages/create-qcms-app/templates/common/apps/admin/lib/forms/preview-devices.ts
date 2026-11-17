/** The builder preview's device frame: presets, rotation, zoom and the size a respondent would see. */

export type DeviceGroup = "phones" | "tablets" | "breakpoints";
export type DeviceKind = "phone" | "tablet" | "desktop" | "custom";
export type Orientation = "portrait" | "landscape";

export interface DevicePreset {
  readonly key: string;
  readonly group: DeviceGroup;
  readonly width: number;
  readonly height: number;
}

export const RESPONSIVE_DEVICE = "responsive";

export const DEVICE_PRESETS: readonly DevicePreset[] = [
  { key: "iphone-se", group: "phones", width: 375, height: 667 },
  { key: "iphone-xr", group: "phones", width: 414, height: 896 },
  { key: "iphone-14-pro", group: "phones", width: 393, height: 852 },
  { key: "pixel-7", group: "phones", width: 412, height: 915 },
  { key: "galaxy-s20-ultra", group: "phones", width: 412, height: 915 },
  { key: "ipad-mini", group: "tablets", width: 768, height: 1024 },
  { key: "ipad-pro", group: "tablets", width: 1024, height: 1366 },
  { key: "surface-pro-7", group: "tablets", width: 912, height: 1368 },
  { key: "compact-edge", group: "breakpoints", width: 640, height: 900 },
  { key: "rail-edge", group: "breakpoints", width: 1024, height: 900 },
];

export const DEVICE_KEYS: readonly string[] = [
  RESPONSIVE_DEVICE,
  ...DEVICE_PRESETS.map((preset) => preset.key),
];

/** Fit scales the frame down to the pane's width; the fixed steps show it at that scale. */
export const ZOOM_CHOICES = ["fit", "50", "75", "100", "125", "150"] as const;
export type ZoomChoice = (typeof ZOOM_CHOICES)[number];

export const SIZE_MIN = 200;
export const SIZE_MAX = 4_000;
export const ZOOM_MIN = 25;
export const ZOOM_MAX = 400;

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface FrameState {
  readonly device: string;
  readonly rotated: boolean;
  readonly zoom: ZoomChoice;
}

export const INITIAL_FRAME: FrameState = { device: RESPONSIVE_DEVICE, rotated: false, zoom: "fit" };

export function presetFor(device: string): DevicePreset | undefined {
  return DEVICE_PRESETS.find((preset) => preset.key === device);
}

export function parseDevice(raw: string): string {
  return DEVICE_KEYS.includes(raw) ? raw : RESPONSIVE_DEVICE;
}

export function parseZoom(raw: string): ZoomChoice {
  return ZOOM_CHOICES.find((choice) => choice === raw) ?? "fit";
}

function clampSize(value: number): number {
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(value)));
}

/** Responsive takes the pane's own size and cannot rotate; a preset is its size, swapped when rotated. */
export function frameSize(state: FrameState, pane: Size): Size {
  const preset = presetFor(state.device);
  if (preset === undefined) return { width: clampSize(pane.width), height: clampSize(pane.height) };
  return state.rotated
    ? { width: preset.height, height: preset.width }
    : { width: preset.width, height: preset.height };
}

export function canRotate(state: FrameState): boolean {
  return presetFor(state.device) !== undefined;
}

export function orientationOf(size: Size): Orientation {
  return size.height >= size.width ? "portrait" : "landscape";
}

/** A named phone or tablet says what it is; anything else is classed by the width it shows. */
export function deviceKind(state: FrameState, size: Size): DeviceKind {
  const group = presetFor(state.device)?.group;
  if (group === "phones") return "phone";
  if (group === "tablets") return "tablet";
  if (size.width < 600) return "phone";
  if (size.width < 1024) return "tablet";
  return "desktop";
}

/** The scale the frame is drawn at, as a whole percentage the layout fact can carry. */
export function zoomPercent(state: FrameState, size: Size, pane: Size): number {
  const raw =
    state.zoom === "fit"
      ? Math.min(100, Math.floor((pane.width / Math.max(1, size.width)) * 100))
      : Number(state.zoom);
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, raw));
}
