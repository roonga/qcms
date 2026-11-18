import type { Appearance, PaletteKind } from "@roonga/qcms-core";

/* Restated rather than imported so the preview bundle loads no core runtime; the test pins them to core. */
export const PREVIEW_PALETTE_KINDS = [
  "light",
  "dark",
  "lightHighContrast",
  "darkHighContrast",
] as const;
export const PREVIEW_CORNERS: readonly string[] = ["sharp", "subtle", "rounded", "pill"];
export const PREVIEW_DENSITIES: readonly string[] = ["compact", "comfortable", "spacious"];
export const PREVIEW_PROGRESS_MODES: readonly string[] = ["side-rail", "top-indicator", "none"];
export const PREVIEW_FACE = /^[a-z0-9]+$/u;
const TOKEN = /^[a-z]+(?:-[a-z]+)*$/u;
const HEX = /^#[0-9a-f]{6}$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPalette(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([token, colour]) => TOKEN.test(token) && typeof colour === "string" && HEX.test(colour),
    )
  );
}

export interface PreviewLook {
  readonly polarity: "light" | "dark";
  readonly highContrast: boolean;
}

export const INITIAL_LOOK: PreviewLook = { polarity: "light", highContrast: false };

/** `null` for a draft with no appearance and for anything malformed; both preview the deployment's look. */
export function parseDraftAppearance(raw: unknown): Appearance | null {
  if (!isRecord(raw) || !isRecord(raw["palettes"])) return null;
  const palettes = raw["palettes"];
  if (!PREVIEW_PALETTE_KINDS.every((kind) => isPalette(palettes[kind]))) return null;
  const { face, corners, density, progress } = raw;
  if (typeof face !== "string" || !PREVIEW_FACE.test(face)) return null;
  if (typeof corners !== "string" || !PREVIEW_CORNERS.includes(corners)) return null;
  if (typeof density !== "string" || !PREVIEW_DENSITIES.includes(density)) return null;
  if (typeof progress !== "string" || !PREVIEW_PROGRESS_MODES.includes(progress)) return null;
  // Checked above as far as the preview reads it; the API validated the whole appearance on save.
  return raw as unknown as Appearance;
}

export function paletteKind(look: PreviewLook): PaletteKind {
  if (look.polarity === "dark") return look.highContrast ? "darkHighContrast" : "dark";
  return look.highContrast ? "lightHighContrast" : "light";
}

/**
 * The carrier's classes, spelled as the portal's root spells them: mode, corners, face and
 * density. Subtle corners and Comfortable density are the base blocks and take no class.
 */
export function surfaceClasses(look: PreviewLook, appearance: Appearance | null): string[] {
  const classes: string[] = [look.polarity];
  if (look.highContrast) classes.push("hc");
  if (appearance === null) return classes;
  if (appearance.corners !== "subtle") classes.push(`radius-${appearance.corners}`);
  classes.push(`font-${appearance.face}`);
  if (appearance.density !== "comfortable") classes.push(`density-${appearance.density}`);
  return classes;
}

/** The draft's palette for this look as colour tokens; empty, so the theme's own apply, without one. */
export function surfaceTokens(
  look: PreviewLook,
  appearance: Appearance | null,
): Readonly<Record<`--${string}`, string>> {
  if (appearance === null) return {};
  return Object.fromEntries(
    Object.entries(appearance.palettes[paletteKind(look)]).map(
      ([token, value]): [`--${string}`, string] => [`--color-${token}`, value.toLowerCase()],
    ),
  );
}
