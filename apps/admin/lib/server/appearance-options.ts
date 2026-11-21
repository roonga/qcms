import { APPEARANCE_FACES, deriveAppearance } from "@roonga/qcms-core";

import { DEFAULT_CORNERS, shippedThemeKey, type ThemeOption } from "../forms/appearance-edit.ts";
import { t, type MessageKey } from "../i18n/en.ts";
import { PREVIEW_THEMES, type PreviewTheme } from "../preview-theme.ts";

/**
 * The accents of the shipped portal themes. Those themes exist as CSS alone, so a form that
 * pins one carries palettes derived from its accent by 107's module rather than the
 * stylesheet's own values.
 */
const SHIPPED_ACCENTS: Readonly<
  Record<PreviewTheme, { readonly primary: string; readonly secondary: string }>
> = {
  slate: { primary: "#2c6e63", secondary: "#4f5b70" },
  harbor: { primary: "#1f5eb8", secondary: "#4a5a75" },
  sand: { primary: "#a24e2c", secondary: "#6d6152" },
  plum: { primary: "#6d28a8", secondary: "#5f5470" },
};

/** Derived on the server, so the browser loads neither the core runtime nor zod for the drawer. */
export function shippedThemeOptions(): readonly ThemeOption[] {
  return PREVIEW_THEMES.map((theme): ThemeOption => {
    const derived = deriveAppearance(SHIPPED_ACCENTS[theme]);
    return {
      key: shippedThemeKey(theme),
      name: t(`preview.island.theme.${theme}` as MessageKey),
      palettes: derived.palettes,
      face: derived.face,
      corners: DEFAULT_CORNERS,
      pageTint: false,
      logo: null,
    };
  });
}

export interface FaceOption {
  readonly key: string;
  /** A font family is a product identifier, so only the system entry is translated. */
  readonly label: string;
}

export function faceOptions(): readonly FaceOption[] {
  return APPEARANCE_FACES.map((face) => ({
    key: face.key,
    label: face.family ?? t("appearance.face.system"),
  }));
}
