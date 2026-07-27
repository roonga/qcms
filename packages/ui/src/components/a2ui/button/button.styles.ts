export const getButtonStyles = (variant: "primary" | "secondary" | "danger" | "ghost" = "primary") => {
	const baseStyles =
		"inline-flex items-center justify-center rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"

	const variantStyles: Record<string, string> = {
		primary:
			"bg-(--color-primary) hover:bg-(--color-primary-hover) active:bg-(--color-primary-active) text-(--color-primary-foreground)",
		secondary:
			"bg-(--color-secondary) hover:bg-(--color-secondary-hover) active:bg-(--color-secondary-active) text-(--color-secondary-foreground)",
		danger:
			"bg-(--color-danger) hover:bg-(--color-danger-hover) active:bg-(--color-danger-active) text-(--color-danger-foreground)",
		ghost:
			"bg-(--color-ghost) hover:bg-(--color-ghost-hover) active:bg-(--color-ghost-active) text-(--color-text) border border-(--color-border)",
	}

	return `${baseStyles} ${variantStyles[variant] || variantStyles.primary}`
}

export const getSizeStyles = (size: "sm" | "md" | "lg" = "md") => {
	const sizeMap: Record<string, string> = {
		sm: "px-3 py-1 text-sm",
		md: "px-4 py-2 text-base",
		lg: "px-6 py-3 text-lg",
	}
	return sizeMap[size] || sizeMap.md
}
