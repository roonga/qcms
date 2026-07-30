/**
 * Per-deployment theme, font and brand config, and the resolution of the
 * respondent's own appearance choices over it (tasks 051 + 052 + 053, ADR-30).
 *
 * A theme is **mutable operator config, not form-grade immutable content**: it is
 * presentation chrome, so it carries none of the immutability or auditability
 * weight answers do. QCMS is single-tenant (ADR-20), so one deployment picks one
 * theme, one corner preset, one brand mark and one default mode / font / density
 * from the environment, and the root layout stamps them onto `<html>` during SSR.
 * There is no admin editor yet (task 049); this module is the whole operator-side
 * selection surface.
 *
 * TWO LAYERS, RESOLVED HERE
 * Config is the deployment's DEFAULT. Mode, font and density are also respondent
 * runtime choices (task 053), carried in cookies, and {@link resolveAppearance}
 * is the one place the two layers meet: an explicit respondent choice wins, and
 * config answers when there is none. Reading the choice on the server rather than
 * in the browser is what makes the first paint correct - see `lib/appearance.ts`
 * for why that rules out `localStorage`.
 *
 * Font CURATION also lives here. `QCMS_PORTAL_FONTS` names the subset of the
 * `@qcms/ui` registry a deployment offers respondents, which for launch is how an
 * operator curates the list; the admin UI over the same setting is Phase-4.
 *
 * Reading the environment stays on the server. Nothing here is a secret, but the
 * portal is a strict BFF (R2) and configuration resolution belongs in one place.
 *
 * An unrecognized value falls back to the default rather than throwing, matching
 * `challenge.ts`: a typo in presentation config must not take a deployment down,
 * and the fallback is the shipped brand-neutral default, which is always safe.
 */

import { fontChoices, fontClass, SYSTEM_FONT_KEY, type FontEntry } from "@qcms/ui/fonts";

// Relative, not the `@/` alias: this module is also loaded directly by Vitest
// (`theme.test.ts`), which does not resolve the Next.js path alias. Every other
// module under `lib/` imports its siblings the same way.
import { t } from "../i18n/en";

import {
  DEFAULT_DENSITY,
  DENSITY_LEVELS,
  densityClass,
  parseDensity,
  parseMode,
  type AppearanceMode,
  type Density,
} from "../appearance";

/** The predefined themes (the theme-palette design deliverable). */
export const PORTAL_THEMES = ["slate", "harbor", "sand", "plum"] as const;
export type PortalTheme = (typeof PORTAL_THEMES)[number];

/** The corner presets of the radius token group. */
export const PORTAL_CORNERS = ["sharp", "subtle", "rounded", "pill"] as const;
export type PortalCorners = (typeof PORTAL_CORNERS)[number];

/**
 * The colour mode a deployment starts respondents in. `auto` follows the OS
 * `prefers-color-scheme` signal; the other three pin the mode, which is how a
 * deployment can ship High-contrast as its default.
 */
export const PORTAL_MODES = ["auto", "light", "dark", "hc"] as const;
export type PortalMode = (typeof PORTAL_MODES)[number];

/**
 * The density level a deployment starts respondents in. The values are
 * `lib/appearance.ts`'s, not a second list: config and the respondent control must
 * offer exactly the same three levels, and density has no `auto` because there is
 * no OS signal for it (no media query reports a preferred spacing).
 */
export const PORTAL_DENSITIES = DENSITY_LEVELS;

/** Slate Teal: the shipped, brand-neutral default. */
export const DEFAULT_THEME: PortalTheme = "slate";
/** Subtle corners are the base of the radius group (no root class needed). */
export const DEFAULT_CORNERS: PortalCorners = "subtle";
/** Default to whatever the respondent's OS asks for. */
export const DEFAULT_MODE: PortalMode = "auto";
/**
 * System is the shipped default font and the one entry that can never be curated
 * away: it downloads nothing, so it is the only choice guaranteed to render.
 */
export const DEFAULT_FONT: string = SYSTEM_FONT_KEY;

// The casts here are the standard `readonly T[]` narrowing gap: `includes` is typed to
// accept only `T`, so an arbitrary string cannot be passed without one, and TypeScript
// does not narrow `raw` from the guard. They are safe precisely because they are
// guarded - the value is only returned as `T` on the branch where `allowed` contains it,
// and every other input falls back. `portalFont` below does the same thing against the
// curated font list, which is a runtime set rather than a literal union.
function oneOf<T extends string>(allowed: readonly T[], raw: string | undefined, fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

/** The configured theme, stamped on `<html data-theme>`. */
export function portalTheme(): PortalTheme {
  return oneOf(PORTAL_THEMES, process.env.QCMS_PORTAL_THEME, DEFAULT_THEME);
}

/** The configured corner preset. */
export function portalCorners(): PortalCorners {
  return oneOf(PORTAL_CORNERS, process.env.QCMS_PORTAL_CORNERS, DEFAULT_CORNERS);
}

/** The configured default colour mode. */
export function portalMode(): PortalMode {
  return oneOf(PORTAL_MODES, process.env.QCMS_PORTAL_MODE, DEFAULT_MODE);
}

/** The configured default density level. */
export function portalDensity(): Density {
  return oneOf(PORTAL_DENSITIES, process.env.QCMS_PORTAL_DENSITY, DEFAULT_DENSITY);
}

/**
 * The respondent-facing font subset this deployment offers: the operator's
 * curation of the `@qcms/ui` registry, read from `QCMS_PORTAL_FONTS` as a list of
 * registry keys separated by commas and/or whitespace.
 *
 * Unset or empty means the whole registry, never an empty list. Unknown keys are
 * dropped rather than fatal (the same typo tolerance as the rest of this module),
 * and System is always present. The respondent font control renders exactly this
 * list; the admin UI over the same setting is Phase-4.
 */
export function portalFontChoices(): readonly FontEntry[] {
  const raw = process.env.QCMS_PORTAL_FONTS ?? "";
  return fontChoices(raw.split(/[\s,]+/u).filter((key) => key !== ""));
}

/**
 * The deployment's default font key, stamped on `<html>`. It must be one the
 * deployment actually offers, so a key that is unknown OR curated out falls back
 * to System rather than selecting a font no respondent could switch back to.
 */
export function portalFont(): string {
  const raw = process.env.QCMS_PORTAL_FONT;
  const offered = portalFontChoices();
  return offered.some((entry) => entry.key === raw) ? (raw as string) : DEFAULT_FONT;
}

/**
 * The deployment's brand mark: the text that names the operator in the header and
 * the document title, plus an optional logo (task 053, folding issue #25).
 *
 * Before this, the header read `<span>QCMS</span>` and the title was the same
 * literal, so an adopter could only rebrand the portal by editing source - and a
 * respondent opening a form was shown the engine's name rather than the name of
 * whoever sent them the link. Both are now config (ADR-27: no hardcoded
 * user-facing text), and `docs/theming.md` documents the two variables.
 */
export interface PortalBrand {
  /** Header text and document title. Never empty. */
  readonly name: string;
  /** A same-origin logo path or a `data:` image, or `undefined` for text only. */
  readonly logoSrc: string | undefined;
}

/**
 * Characters that must never appear in a value destined for an HTML attribute:
 * whitespace, both quote styles, the angle brackets and a backslash.
 */
const UNSAFE_IN_ATTRIBUTE = /[\s"'<>\\]/u;

/** `data:image/<subtype>` followed by the parameter or the payload separator. */
const DATA_IMAGE = /^data:image\/[\w.+-]+[,;]/u;

/**
 * Whether a configured logo source is one the shipped Content-Security-Policy can
 * actually load.
 *
 * `csp.ts` sends `img-src 'self' data:` (SEC-9), so a browser refuses an off-origin
 * logo outright. Accepting one here would render a broken image on every page and
 * put pressure on the CSP to be widened, so this accepts exactly what the policy
 * already permits and nothing else: a root-relative path this deployment serves
 * itself, or an inline `data:` image.
 *
 * `//host/x` is rejected explicitly. It starts with `/` but is a protocol-relative
 * URL to another origin, which is precisely the case a naive "starts with a slash"
 * test lets through.
 *
 * Written as three narrow tests rather than one alternation because the single
 * regex that expressed this had overlapping quantified character classes and so
 * backtracked super-linearly (`sonarjs/super-linear-regex`). Each pattern here has
 * one quantifier over a class the next cannot also match.
 */
function isLoadableLogo(value: string): boolean {
  if (value === "" || UNSAFE_IN_ATTRIBUTE.test(value)) return false;
  if (value.startsWith("//")) return false;
  return value.startsWith("/") || DATA_IMAGE.test(value);
}

/**
 * The configured brand mark. An unset or blank name falls back to the catalog's
 * generic default, and a logo value the CSP could not load is dropped rather than
 * being allowed to render as a broken image - the same typo tolerance as the rest
 * of this module, and for the same reason: presentation config must not be able to
 * take a deployment down or deface it.
 */
export function portalBrand(): PortalBrand {
  const name = (process.env.QCMS_PORTAL_BRAND_NAME ?? "").trim();
  const logo = (process.env.QCMS_PORTAL_BRAND_LOGO ?? "").trim();
  return {
    name: name === "" ? t("brand.defaultName") : name,
    logoSrc: isLoadableLogo(logo) ? logo : undefined,
  };
}

/**
 * The respondent's appearance choices for this request: their explicit choice
 * where they made one, the deployment's configured default where they did not.
 *
 * `mode` can still be `auto` on the way out, and that is the point: `auto` means
 * "no server-side answer exists, ask the OS", which only the pre-paint script in
 * `app/layout.tsx` can do. `modeChosen` tells the caller which case it is looking
 * at, so the script can be told not to second-guess a real choice.
 */
export interface ResolvedAppearance {
  readonly mode: PortalMode;
  /** True when `mode` came from the respondent's cookie, not from config. */
  readonly modeChosen: boolean;
  readonly font: string;
  readonly density: Density;
}

/** The three appearance cookie values as read from the request's cookie jar. */
export interface AppearanceCookies {
  readonly mode: string | undefined;
  readonly font: string | undefined;
  readonly density: string | undefined;
}

/**
 * Resolve the two layers. Precedence for each axis is: the respondent's cookie,
 * then this deployment's config. A cookie holding nonsense (a hand-edited value, a
 * key curated away since it was chosen) is treated as no choice at all, which is
 * why a font cookie is checked against the OFFERED list rather than the whole
 * registry: a deployment that stops offering a face must not keep serving it to the
 * respondents who had selected it, because the control could no longer switch back.
 */
export function resolveAppearance(cookies: AppearanceCookies): ResolvedAppearance {
  const chosenMode = parseMode(cookies.mode);
  const offered = portalFontChoices();
  const chosenFont = offered.some((entry) => entry.key === cookies.font)
    ? (cookies.font as string)
    : undefined;
  return {
    mode: chosenMode ?? portalMode(),
    modeChosen: chosenMode !== undefined,
    font: chosenFont ?? portalFont(),
    density: parseDensity(cookies.density) ?? portalDensity(),
  };
}

/**
 * The root class for a corner preset. Subtle is the base `:root` block in
 * `theme.css`, so it needs no class at all.
 */
export function cornersClass(corners: PortalCorners): string {
  return corners === DEFAULT_CORNERS ? "" : `radius-${corners}`;
}

/**
 * The root class for the first paint. `auto` renders as `light` and the
 * pre-paint bootstrap script corrects it from the OS signals before the browser
 * paints, so a dark-mode respondent still never sees a light flash.
 *
 * The return type is `AppearanceMode`, not `string`: `auto` is a config keyword
 * that never names a rendered mode, and narrowing here is what lets the layout
 * hand the value straight to the controls without a cast.
 */
export function modeClass(mode: PortalMode): AppearanceMode {
  return mode === "auto" ? "light" : mode;
}

/**
 * The `<html class>` value for the first paint: mode + corners + font + density.
 *
 * The font class is always emitted, System included: `:root.font-system` restates
 * the base System stack, so the class is a positive selection rather than an
 * absence, which is what lets the font control switch back to System by swapping
 * one class. Density is the opposite convention (Comfortable is an absence,
 * matching Subtle corners), because the base spacing block IS Comfortable and a
 * `.density-comfortable` class restating it would be a second place to edit.
 */
export function rootClassName(appearance: ResolvedAppearance, corners: PortalCorners): string {
  return [
    modeClass(appearance.mode),
    cornersClass(corners),
    fontClass(appearance.font),
    densityClass(appearance.density),
  ]
    .filter(Boolean)
    .join(" ");
}
