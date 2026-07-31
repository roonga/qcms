export type CardSize = "none" | "sm" | "md" | "lg"

const paddingMap = { none: "p-0", sm: "p-3", md: "p-4", lg: "p-6" }
const shadowMap = { none: "shadow-none", sm: "shadow-sm", md: "shadow-md", lg: "shadow-lg" }
const radiusMap = { none: "rounded-none", sm: "rounded-sm", md: "rounded-md", lg: "rounded-lg" }

export const getCardStyles = (
	padding: CardSize = "md",
	shadow: CardSize = "none",
	radius: CardSize = "md",
	border = false,
) =>
	[
		"bg-(--color-surface)",
		paddingMap[padding],
		shadowMap[shadow],
		radiusMap[radius],
		border ? "border border-(--color-border)" : "",
	]
		.filter(Boolean)
		.join(" ")
