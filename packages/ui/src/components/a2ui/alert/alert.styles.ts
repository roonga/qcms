type Variant = "info" | "success" | "warning" | "error"

const variantStyles: Record<Variant, string> = {
	info: "bg-[var(--color-info-subtle)] border-[var(--color-info)] text-[var(--color-info-fg)]",
	success: "bg-[var(--color-success-subtle)] border-[var(--color-success)] text-[var(--color-success-fg)]",
	warning: "bg-[var(--color-warning-subtle)] border-[var(--color-warning)] text-[var(--color-warning-fg)]",
	error: "bg-[var(--color-danger-subtle)] border-[var(--color-danger)] text-[var(--color-danger-fg)]",
}

export const getAlertStyles = (variant: Variant = "info") =>
	["rounded-md border px-4 py-3 text-sm", variantStyles[variant]].join(" ")

export const alertTitleStyles = "font-semibold mb-1"
export const alertBodyStyles = "leading-relaxed"
