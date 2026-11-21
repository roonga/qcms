import type { Appearance } from "@roonga/qcms-core";
import { SHIPPED_THEMES } from "@roonga/qcms-ui/shipped-themes";

import {
  DEFAULT_CORNERS,
  shippedThemeKey,
  type ThemeOption,
  type ThemePalettes,
} from "../forms/appearance-edit.ts";
import { t, type MessageKey } from "../i18n/en.ts";

export function shippedThemeOptions(): readonly ThemeOption[] {
  return SHIPPED_THEMES.map((theme): ThemeOption => ({
    key: shippedThemeKey(theme.key),
    name: t(`preview.island.theme.${theme.key}` as MessageKey),
    palettes: theme.palettes as ThemePalettes,
    face: theme.face as Appearance["face"],
    corners: DEFAULT_CORNERS,
    pageTint: false,
    logo: null,
  }));
}

export interface FaceOption {
  readonly key: string;
  /** A font family is a product identifier, so only the system entry is translated. */
  readonly label: string;
}

/** The registry faces, restated here because the admin loads no kernel runtime (R2). */
const FACE_FAMILIES: readonly (readonly [string, string | null])[] = [
  ["system", null],
  ["atkinson", "Atkinson Hyperlegible"],
  ["lexend", "Lexend"],
  ["opendyslexic", "OpenDyslexic"],
  ["inter", "Inter"],
  ["roboto", "Roboto"],
  ["opensans", "Open Sans"],
  ["lato", "Lato"],
  ["poppins", "Poppins"],
  ["montserrat", "Montserrat"],
  ["andika", "Andika"],
  ["fredoka", "Fredoka"],
  ["baloo2", "Baloo 2"],
  ["comicneue", "Comic Neue"],
  ["patrickhand", "Patrick Hand"],
  ["merriweather", "Merriweather"],
  ["lora", "Lora"],
  ["ptserif", "PT Serif"],
  ["librebaskerville", "Libre Baskerville"],
  ["ibmplexserif", "IBM Plex Serif"],
  ["publicsans", "Public Sans"],
  ["jetbrainsmono", "JetBrains Mono"],
  ["geistmono", "Geist Mono"],
];

export function faceOptions(): readonly FaceOption[] {
  return FACE_FAMILIES.map(([key, family]) => ({
    key,
    label: family ?? t("appearance.face.system"),
  }));
}
