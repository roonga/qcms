const sizeMap = {
	xs: "text-xs",
	sm: "text-sm",
	md: "text-base",
	lg: "text-lg",
	xl: "text-xl",
	"2xl": "text-2xl",
}

const weightMap = {
	normal: "font-normal",
	medium: "font-medium",
	semibold: "font-semibold",
	bold: "font-bold",
}

const colorMap = {
	default: "text-(--color-text)",
	muted: "text-(--color-text-muted)",
	primary: "text-(--color-primary)",
	danger: "text-(--color-danger)",
}

const alignMap = {
	left: "text-left",
	center: "text-center",
	right: "text-right",
	justify: "text-justify",
}

export const getTextStyles = (
	size: "xs" | "sm" | "md" | "lg" | "xl" | "2xl" = "md",
	weight: "normal" | "medium" | "semibold" | "bold" = "normal",
	color: "default" | "muted" | "primary" | "danger" = "default",
	align?: "left" | "center" | "right" | "justify",
	italic?: boolean,
	truncate?: boolean,
) =>
	[
		sizeMap[size],
		weightMap[weight],
		colorMap[color],
		align ? alignMap[align] : "",
		italic ? "italic" : "",
		truncate ? "truncate" : "",
	]
		.filter(Boolean)
		.join(" ")
