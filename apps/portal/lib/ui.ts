/**
 * Shell chrome class helpers (task 029). These style the portal's own chrome
 * buttons (Continue / Back / Start) and links - NOT the A2UI form controls, which
 * are rendered and styled by @qcms/ui. Kept as token-based Tailwind strings so
 * adopter re-skinning through the color tokens flows here too.
 */

const BUTTON_BASE =
  "inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-focus-ring) focus-visible:ring-offset-2 focus-visible:ring-offset-(--color-surface) disabled:cursor-not-allowed disabled:opacity-50";

export type ButtonVariant = "primary" | "secondary";

export function buttonClass(variant: ButtonVariant): string {
  if (variant === "secondary") {
    return `${BUTTON_BASE} border border-(--color-border-strong) bg-transparent text-(--color-text) hover:bg-(--color-ghost-hover)`;
  }
  return `${BUTTON_BASE} bg-(--color-primary) text-(--color-primary-foreground) hover:bg-(--color-primary-hover) active:bg-(--color-primary-active)`;
}
