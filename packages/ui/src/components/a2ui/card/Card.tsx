import type { ReactNode } from "react"
import { type CardSize, getCardStyles } from "./card.styles"

interface CardProps {
	readonly padding?: CardSize
	readonly shadow?: CardSize
	readonly radius?: CardSize
	readonly border?: boolean
	readonly children?: ReactNode
}

export function Card({ padding = "md", shadow = "none", radius = "md", border = false, children }: CardProps) {
	return <div className={getCardStyles(padding, shadow, radius, border)}>{children}</div>
}
