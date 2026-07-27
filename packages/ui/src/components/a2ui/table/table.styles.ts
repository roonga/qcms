export const getTableStyles = () => ({
	root: "w-full border-collapse text-sm",
	column: [
		"px-3 py-2 text-left font-medium text-(--color-text-muted)",
		"border-b border-(--color-border)",
		"outline-none",
		"focus-visible:outline-2 focus-visible:outline-(--color-primary)",
	].join(" "),
	row: [
		"border-b border-(--color-border) outline-none cursor-default",
		"data-[hovered]:bg-(--color-surface)",
		"data-[selected]:bg-(--color-primary)/10",
		"data-[focused]:outline-2 data-[focused]:outline-(--color-primary)",
	].join(" "),
	cell: ["px-3 py-2 text-(--color-text)", "focus-visible:outline-2 focus-visible:outline-(--color-primary)"].join(" "),
})
