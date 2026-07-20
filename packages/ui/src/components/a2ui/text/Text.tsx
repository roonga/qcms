import type { ReactNode } from "react"
import { getTextStyles } from "./text.styles"

interface TextProps {
	readonly as?: "h1" | "h2" | "h3" | "h4" | "p" | "span" | "label"
	readonly size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl"
	readonly weight?: "normal" | "medium" | "semibold" | "bold"
	readonly color?: "default" | "muted" | "primary" | "danger"
	readonly align?: "left" | "center" | "right" | "justify"
	readonly italic?: boolean
	readonly truncate?: boolean
	readonly children?: ReactNode
}

export function Text({
	as: Tag = "p",
	size = "md",
	weight = "normal",
	color = "default",
	align,
	italic,
	truncate,
	children,
}: TextProps) {
	return <Tag className={getTextStyles(size, weight, color, align, italic, truncate)}>{children}</Tag>
}
