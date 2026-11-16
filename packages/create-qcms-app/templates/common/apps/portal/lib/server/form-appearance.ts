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

const PACKED_VERSION = "1";
const PACKED_SEPARATOR = "~";
const FACE_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * The appearance in a form small enough for a cookie (the four palettes share one name
 * list) and written only in characters a cookie value carries unencoded. `undefined`
 * when the palettes do not share one token set.
 */
export function packFormAppearance(appearance: FormAppearance): string | undefined {
  const names = Object.keys(appearance.palettes.light).sort();
  const rows: string[] = [];
  for (const kind of PALETTE_KINDS) {
    const palette = appearance.palettes[kind];
    if (Object.keys(palette).sort().join(".") !== names.join(".")) return undefined;
    rows.push(names.map((name) => (palette[name] ?? "").slice(1)).join(""));
  }
  if (!FACE_KEY.test(appearance.face)) return undefined;
  return [
    PACKED_VERSION,
    appearance.logo ?? "",
    appearance.face,
    appearance.corners,
    appearance.density,
    names.join("."),
    ...rows,
  ].join(PACKED_SEPARATOR);
}

/** The inverse of {@link packFormAppearance}, validated as strictly as the API's own copy. */
export function unpackFormAppearance(packed: string | undefined): FormAppearance | null {
  if (packed === undefined) return null;
  const [version, logo, face, corners, density, joined, ...rows] = packed.split(PACKED_SEPARATOR);
  if (version !== PACKED_VERSION || joined === undefined || rows.length !== PALETTE_KINDS.length) {
    return null;
  }
  const names = joined.split(".");
  const palettes: Record<string, Record<string, string>> = {};
  for (const [at, kind] of PALETTE_KINDS.entries()) {
    const row = rows[at] ?? "";
    if (row.length !== names.length * 6) return null;
    palettes[kind] = Object.fromEntries(
      names.map((name, index) => [name, `#${row.slice(index * 6, index * 6 + 6)}`]),
    );
  }
  return parseFormAppearance({
    palettes,
    logo: logo === "" ? null : logo,
    face,
    corners,
    density,
  });
}

const SESSION_PATH = /^\/s\/([^/]+)\/?$/u;

/** The session a step page belongs to, from the environment-stripped path. */
export function sessionIdFromPath(path: string | null): string | undefined {
  if (path === null) return undefined;
  return SESSION_PATH.exec(path)?.[1];
}

/** The completion page, which has no session left to read and keeps the look it was handed at submit. */
export function isCompletionPath(path: string | null): boolean {
  return path === "/done" || path === "/done/";
}
