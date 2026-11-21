import type { Appearance } from "@roonga/qcms-core";

import { DEFAULT_TEXT_SIZE } from "./text-size.ts";

/** A palette set as the drawer carries it: plain data, so no core runtime reaches the browser. */
export type ThemePalettes = Appearance["palettes"];

/** One row of the drawer's Theme list: a shipped theme or one of the workspace's own. */
export interface ThemeOption {
  readonly key: string;
  readonly name: string;
  readonly palettes: ThemePalettes;
  readonly face: Appearance["face"];
  readonly corners: Appearance["corners"];
  readonly pageTint: boolean;
  readonly logo: string | null;
}

export const SHIPPED_THEME_PREFIX = "shipped";
export const WORKSPACE_THEME_PREFIX = "workspace";

export function shippedThemeKey(name: string): string {
  return `${SHIPPED_THEME_PREFIX}:${name}`;
}

export function workspaceThemeKey(themeId: string): string {
  return `${WORKSPACE_THEME_PREFIX}:${themeId}`;
}

export const DEFAULT_CORNERS: Appearance["corners"] = "subtle";
export const DEFAULT_DENSITY: Appearance["density"] = "comfortable";
export const DEFAULT_PROGRESS: Appearance["progress"] = "top-indicator";

/**
 * A theme carries the look: palettes, face, corners, page tint and logo. Density, text size and
 * progress are the form's own, so choosing a theme leaves them where the author put them.
 */
export function appearanceFromTheme(theme: ThemeOption, base: Appearance | null): Appearance {
  return {
    palettes: theme.palettes,
    logo: theme.logo,
    face: theme.face,
    corners: theme.corners,
    pageTint: theme.pageTint,
    density: base?.density ?? DEFAULT_DENSITY,
    textSize: base?.textSize ?? DEFAULT_TEXT_SIZE,
    progress: base?.progress ?? DEFAULT_PROGRESS,
  };
}

function samePalettes(a: ThemePalettes, b: ThemePalettes): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The theme whose palettes the appearance carries, so the list can mark one row current. */
export function currentThemeKey(
  appearance: Appearance | null,
  themes: readonly ThemeOption[],
): string | undefined {
  if (appearance === null) return undefined;
  return themes.find((theme) => samePalettes(theme.palettes, appearance.palettes))?.key;
}

export function sameAppearance(a: Appearance | null, b: Appearance | null): boolean {
  if (a === null || b === null) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The accent, page and ink of the light palette, which the Theme row shows as a chip. */
export function themeSwatch(palettes: ThemePalettes): readonly [string, string, string] {
  const light = palettes.light;
  return [light.primary, light.background, light.text];
}
