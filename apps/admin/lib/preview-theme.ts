/**
 * The preview island's theme and mode vocabulary (task 058, ADR-38).
 *
 * Pure, client-safe and shared, for the same reason `lib/appearance.ts` is: the page
 * resolves the deployment's configured theme during SSR and the island's switcher
 * re-selects it in the browser, so the value list, the attribute and the mode class
 * names have to be one definition rather than two that agree by inspection.
 *
 * ## What this module deliberately does NOT hold
 *
 * Token values. Not one. A theme reaches the island through `@qcms/ui`'s stylesheets
 * and the `data-qcms-theme-scope` carrier ADR-38 defines, never through a JavaScript
 * map of colours: `scripts/check-admin-theme.mjs` fails the build on any hex, colour
 * function or Tailwind palette utility anywhere under `app/` or `components/`, so an
 * admin-side copy of the palette is not merely discouraged, it is unbuildable. What is
 * here is the *vocabulary* - four theme keys and three mode classes - which is the
 * contract's public surface and carries no design decision of its own.
 *
 * ## Why the theme list is a copy rather than an import
 *
 * `PORTAL_THEMES` lives in `apps/portal/lib/server/theme.ts`, and the portal and the
 * admin are separate deployables with no shared package between them - the same call
 * `MIN_PASSWORD_LENGTH` makes in `lib/server/config.ts`. A drift here is visible rather
 * than dangerous: an unknown key falls back to the base theme, which is exactly what
 * the portal does with the same environment variable, so the worst outcome is a
 * switcher that offers one theme fewer than a deployment can serve. Task 049's custom
 * themes extend this list; nothing else has to move for them.
 *
 * ## Why `slate` is the base and not a `[data-theme]` block
 *
 * The token sheet authors Slate Teal in its bare anchor block and gives the other three
 * a `[data-theme="…"]` override, so `data-theme="slate"` matches nothing and is inert.
 * The attribute is stamped anyway, because the switcher has to be able to return to it:
 * a control that could select Slate only by removing an attribute would be a second
 * code path for one of four otherwise identical choices.
 */

/** The predefined respondent themes (task 051's palette, ADR-30). */
export const PREVIEW_THEMES = ["slate", "harbor", "sand", "plum"] as const;
export type PreviewTheme = (typeof PREVIEW_THEMES)[number];

/** Slate Teal: the shipped, brand-neutral base, and the answer when config is unset. */
export const DEFAULT_PREVIEW_THEME: PreviewTheme = "slate";

/**
 * The three respondent modes, which are also the class names the carrier wears.
 *
 * `light` is a real selection rather than an absence: the sheet authors Light in its
 * bare anchor block, but the class has to be nameable so the switcher can return to it
 * the same way it reaches the other two. There is no `auto` here, unlike the portal's
 * config: an author is exploring how a deployment can look, and "whatever this laptop
 * prefers" is not one of the appearances a respondent can be served.
 */
export const PREVIEW_MODES = ["light", "dark", "hc"] as const;
export type PreviewMode = (typeof PREVIEW_MODES)[number];

/** The island opens in Light, per the task's "configured theme, in light mode". */
export const DEFAULT_PREVIEW_MODE: PreviewMode = "light";

/**
 * The attribute that makes a subtree resolve the portal token set (ADR-38, task 060).
 *
 * Named once here so the island, its tests and the styles that restate the portal's
 * text-spacing floors all spell it the same way.
 */
export const THEME_SCOPE_ATTRIBUTE = "data-qcms-theme-scope";

/**
 * A recognized theme key, or `undefined`.
 *
 * `undefined` rather than a substituted default is the point, exactly as it is in
 * `parseMode`: the caller decides what "no answer" means, and a parser that silently
 * returned Slate would make a typo in deployment config indistinguishable from an
 * operator who chose the base theme.
 */
export function parsePreviewTheme(raw: string | undefined): PreviewTheme | undefined {
  return PREVIEW_THEMES.find((theme) => theme === raw);
}

/** A recognized mode class, or `undefined`. Same contract as {@link parsePreviewTheme}. */
export function parsePreviewMode(raw: string | undefined): PreviewMode | undefined {
  return PREVIEW_MODES.find((mode) => mode === raw);
}
