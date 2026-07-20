import type { ReactNode } from "react"
import { getFlexStyles } from "./layout.styles"

interface FlexProps {
	readonly direction?: "row" | "column" | "row-reverse" | "column-reverse"
	readonly gap?: "none" | "xs" | "sm" | "md" | "lg" | "xl"
	readonly align?: "start" | "center" | "end" | "stretch" | "baseline"
	readonly justify?: "start" | "center" | "end" | "between" | "around" | "evenly"
	readonly wrap?: boolean
	readonly children?: ReactNode
}

export function Flex({
	direction = "row",
	gap = "md",
	align = "stretch",
	justify = "start",
	wrap = false,
	children,
}: FlexProps) {
	return <div className={getFlexStyles(direction, gap, align, justify, wrap)}>{children}</div>
}
