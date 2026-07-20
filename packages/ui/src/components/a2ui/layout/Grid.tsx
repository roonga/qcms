import type { ReactNode } from "react"
import { getGridStyles } from "./layout.styles"

interface GridProps {
	readonly columns?: number
	readonly gap?: "none" | "xs" | "sm" | "md" | "lg" | "xl"
	readonly align?: "start" | "center" | "end" | "stretch"
	readonly children?: ReactNode
}

export function Grid({ columns = 1, gap = "md", align = "start", children }: GridProps) {
	return <div className={getGridStyles(columns, gap, align)}>{children}</div>
}
