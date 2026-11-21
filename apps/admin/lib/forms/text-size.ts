/* Restated rather than imported so the drawer loads no core runtime in the browser; the test pins them to core. */
export const TEXT_SIZE_MIN = 16;
export const TEXT_SIZE_MAX = 24;

/** The product of the admin's base and the respondent's scale never renders above this (Q9). */
export const TEXT_SIZE_PRODUCT_CAP = 32;

/** The scales a respondent may choose, as percentages of the admin's base (Q9). */
export const RESPONDENT_SCALES = [100, 125, 150, 200] as const;

export const DEFAULT_TEXT_SIZE = 18;

export interface TextSizePreset {
  readonly key: "small" | "medium" | "large";
  readonly px: number;
}

export const TEXT_SIZE_PRESETS: readonly TextSizePreset[] = [
  { key: "small", px: 16 },
  { key: "medium", px: 18 },
  { key: "large", px: 20 },
];

/** Custom is a state the value puts the control in, never a value of its own. */
export type TextSizeMark = TextSizePreset["key"] | "custom";

/** Exactly one mark is current, never none: a preset when the value is one of theirs, else Custom. */
export function textSizeMark(px: number): TextSizeMark {
  return TEXT_SIZE_PRESETS.find((preset) => preset.px === px)?.key ?? "custom";
}

export function presetSize(key: TextSizePreset["key"]): number {
  return TEXT_SIZE_PRESETS.find((preset) => preset.key === key)?.px ?? DEFAULT_TEXT_SIZE;
}

export type TextSizeEntry =
  | { readonly status: "ok"; readonly px: number }
  | { readonly status: "empty" }
  | { readonly status: "notANumber" }
  | { readonly status: "belowFloor" }
  | { readonly status: "aboveCap" };

/**
 * What a typed field holds. A value outside the bounds is reported rather than clamped, so the
 * caller keeps the last valid size applied while this one is being corrected.
 */
export function readTextSize(raw: string): TextSizeEntry {
  const trimmed = raw.trim();
  if (trimmed === "") return { status: "empty" };
  if (!/^\d+$/u.test(trimmed)) return { status: "notANumber" };
  const px = Number.parseInt(trimmed, 10);
  if (px < TEXT_SIZE_MIN) return { status: "belowFloor" };
  if (px > TEXT_SIZE_MAX) return { status: "aboveCap" };
  return { status: "ok", px };
}

export function isTextSize(px: number): boolean {
  return Number.isInteger(px) && px >= TEXT_SIZE_MIN && px <= TEXT_SIZE_MAX;
}

/** One step, which stops at the bounds rather than overshooting them. */
export function stepTextSize(px: number, by: number): number {
  return Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, px + by));
}

export function canStepTextSize(px: number, by: number): boolean {
  return stepTextSize(px, by) !== px;
}

/** The size a respondent sees at `scalePercent`, held to the 32 px cap (Q9). */
export function respondentTextSize(base: number, scalePercent: number): number {
  return Math.min(TEXT_SIZE_PRODUCT_CAP, Math.round((base * scalePercent) / 100));
}

/** The smallest offered scale at which this base reaches the cap, or null when none does. */
export function cappedAtScale(base: number): number | null {
  return (
    RESPONDENT_SCALES.find((scale) => Math.round((base * scale) / 100) > TEXT_SIZE_PRODUCT_CAP) ??
    null
  );
}
