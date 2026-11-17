import { Appearance, type PaletteKind } from "@roonga/qcms-core";

/** The look the preview toolbar picks: a polarity, with or without high contrast. */
export interface PreviewLook {
  readonly polarity: "light" | "dark";
  readonly highContrast: boolean;
}

export const INITIAL_LOOK: PreviewLook = { polarity: "light", highContrast: false };

/** `null` for a draft with no appearance and for anything malformed; both preview the deployment's look. */
export function parseDraftAppearance(raw: unknown): Appearance | null {
  if (raw === null || raw === undefined) return null;
  const parsed = Appearance.safeParse(raw);
  return parsed.success ? parsed.data : null;
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
