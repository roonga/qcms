/** Share only theme vocabulary, never token values; stylesheets own the palettes. Mirror across deployables and fall back safely on unknown keys. */

export const PREVIEW_THEMES = ["slate", "harbor", "sand", "plum"] as const;
export type PreviewTheme = (typeof PREVIEW_THEMES)[number];

export const DEFAULT_PREVIEW_THEME: PreviewTheme = "slate";

/** Preview modes are explicit appearances; do not offer machine-dependent auto mode while authors compare respondent layouts. */
export const PREVIEW_MODES = ["light", "dark", "hc"] as const;
export type PreviewMode = (typeof PREVIEW_MODES)[number];

export const DEFAULT_PREVIEW_MODE: PreviewMode = "light";

export const THEME_SCOPE_ATTRIBUTE = "data-qcms-theme-scope";

/** Return undefined for unknown themes so a typo remains distinguishable from an explicit base choice. */
export function parsePreviewTheme(raw: string | undefined): PreviewTheme | undefined {
  return PREVIEW_THEMES.find((theme) => theme === raw);
}

export function parsePreviewMode(raw: string | undefined): PreviewMode | undefined {
  return PREVIEW_MODES.find((mode) => mode === raw);
}
