/**
 * Shell chrome class helpers (task 029). These style the portal's own chrome
 * buttons (Continue / Back / Start) and links - NOT the A2UI form controls, which
 * are rendered and styled by @roonga/qcms-ui. Kept as token-based Tailwind strings so
 * adopter re-skinning through the color tokens flows here too.
 */

/**
 * `qcms-chrome-button` is not a Tailwind utility and compiles to nothing here: it is
 * the hook `app/globals.css` needs to reach these three buttons from a media query
 * (issue #28). Under `forced-colors: active` the primary variant is a fill with no
 * border, so the user's palette flattens it into plain text unless a boundary is
 * added, and the `ring-*` focus indicator is a box-shadow, which forced colours
 * delete outright. Both fixes are colour decisions, so they live in the stylesheet
 * with the rest of the forced-colours block rather than as variants in this string.
 */
const BUTTON_BASE =
  "qcms-chrome-button inline-flex items-center justify-center rounded-(--radius-control) min-h-(--space-control-h) px-(--space-control-pad-x) py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-focus-ring) focus-visible:ring-offset-2 focus-visible:ring-offset-(--color-surface) disabled:cursor-not-allowed disabled:opacity-50";

export type ButtonVariant = "primary" | "secondary";

export function buttonClass(variant: ButtonVariant): string {
  if (variant === "secondary") {
    return `${BUTTON_BASE} border border-(--color-border-strong) bg-transparent text-(--color-text) hover:bg-(--color-ghost-hover)`;
  }
  return `${BUTTON_BASE} bg-(--color-primary) text-(--color-primary-foreground) hover:bg-(--color-primary-hover) active:bg-(--color-primary-active)`;
}
