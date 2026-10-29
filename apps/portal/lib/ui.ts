const BUTTON_BASE =
  "qcms-chrome-button inline-flex items-center justify-center rounded-(--radius-control) min-h-(--space-control-h) px-(--space-control-pad-x) py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-focus-ring) focus-visible:ring-offset-2 focus-visible:ring-offset-(--color-surface) disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

export type ButtonVariant = "primary" | "secondary";

export function buttonClass(variant: ButtonVariant): string {
  if (variant === "secondary") {
    return `${BUTTON_BASE} border border-(--color-border-strong) bg-transparent text-(--color-text) hover:bg-(--color-ghost-hover)`;
  }
  return `${BUTTON_BASE} bg-(--color-primary) text-(--color-primary-foreground) hover:bg-(--color-primary-hover) active:bg-(--color-primary-active)`;
}
