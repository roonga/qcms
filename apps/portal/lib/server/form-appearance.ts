import { fontByKey } from "@roonga/qcms-ui/fonts";
import { z } from "zod";

// Relative, not the `@/` alias: Vitest resolves no Next path aliases.
import { DENSITY_LEVELS } from "../appearance";

import { PORTAL_CORNERS } from "./theme";

const PALETTE_KINDS = ["light", "dark", "lightHighContrast", "darkHighContrast"] as const;
type PaletteKind = (typeof PALETTE_KINDS)[number];

/**
 * Both patterns are what makes the generated stylesheet safe to inline: a token name and
 * a value can carry nothing but these characters into the CSS text.
 */
const TOKEN_NAME = /^[a-z]+(?:-[a-z]+)*$/u;
const HEX = /^#[0-9a-f]{6}$/iu;
const LOGO_KEY = /^[0-9a-f]{64}$/u;

const Palette = z.record(
  z.string().regex(TOKEN_NAME),
  z
    .string()
    .regex(HEX)
    .transform((value) => value.toLowerCase()),
);

/** The axes the portal applies; the API validated the whole appearance already. */
const FormAppearanceSchema = z.object({
  palettes: z.object(
    Object.fromEntries(PALETTE_KINDS.map((kind) => [kind, Palette])) as Record<
      PaletteKind,
      typeof Palette
    >,
  ),
  logo: z.string().regex(LOGO_KEY).nullable(),
  face: z.string().refine((key) => fontByKey(key) !== undefined),
  corners: z.enum(PORTAL_CORNERS),
  density: z.enum(DENSITY_LEVELS),
});

export type FormAppearance = z.infer<typeof FormAppearanceSchema>;

/** `null` for a version with no appearance and for anything malformed: both fall back to the deployment. */
export function parseFormAppearance(raw: unknown): FormAppearance | null {
  if (raw === null || raw === undefined) return null;
  const parsed = FormAppearanceSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Presence-only, like `data-qcms-theme-scope`: the generated rules match the bare attribute. */
export const FORM_APPEARANCE_ATTRIBUTE = "data-qcms-form-appearance";

/**
 * One class more than the theme's own `[data-theme].dark.hc` block in every mode, so a
 * form's palette outranks every deployment theme without depending on stylesheet order.
 */
const SCOPE = `html:root[${FORM_APPEARANCE_ATTRIBUTE}]`;
const SELECTORS: Readonly<Record<PaletteKind, string>> = {
  light: `${SCOPE}:not(.dark):not(.hc)`,
  dark: `${SCOPE}.dark:not(.hc)`,
  lightHighContrast: `${SCOPE}.hc:not(.dark)`,
  darkHighContrast: `${SCOPE}.dark.hc`,
};

/** The form's four palettes as token blocks keyed to the root's mode classes. */
export function formAppearanceCss(appearance: FormAppearance): string {
  return PALETTE_KINDS.map((kind) => {
    const declarations = Object.entries(appearance.palettes[kind])
      .map(([token, value]) => `--color-${token}:${value};`)
      .join("");
    return `${SELECTORS[kind]}{${declarations}}`;
  }).join("\n");
}

/** The form's logo through the portal's own logo route, so SEC-9's `img-src 'self'` holds. */
export function formLogoSrc(appearance: FormAppearance, basePath: string): string | undefined {
  return appearance.logo === null ? undefined : `${basePath}/logo/${appearance.logo}`;
}

const SESSION_PATH = /^\/s\/([^/]+)\/?$/u;

/** The session a step page belongs to, from the environment-stripped path. */
export function sessionIdFromPath(path: string | null): string | undefined {
  if (path === null) return undefined;
  return SESSION_PATH.exec(path)?.[1];
}
