/* A manifest member and a generated PNG cannot reference a CSS custom property, so these four are the
   one place outside `app/theme.css` that writes a colour down. `brand.test.ts` pins each to the sheet. */

/** Splash and generated-icon ground: the Dark mode page colour. */
export const PWA_GROUND_COLOR = "#04080f";

/** The mark drawn on that ground: the accent as Dark mode states it, which the cobalt of Light mode is not legible as. */
export const PWA_MARK_COLOR = "#7aa2ff";

/** `theme_color`: the accent, which colours the installed window's title bar and the task switcher. */
export const PWA_ACCENT_COLOR = "#2456c6";

/** `theme-color` per colour scheme: each mode's page colour, so browser chrome matches the document. */
export const PWA_PAGE_COLOR_LIGHT = "#f4f6f9";
export const PWA_PAGE_COLOR_DARK = PWA_GROUND_COLOR;
