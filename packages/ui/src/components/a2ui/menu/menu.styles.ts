export const getMenuStyles = () => ({
	trigger: [
		"rounded px-3 py-1.5 text-sm font-medium",
		"bg-(--color-background-muted) text-(--color-text)",
		"border border-(--color-border)",
		"hover:bg-(--color-border) transition-colors",
		"focus-visible:outline-2 focus-visible:outline-(--color-primary)",
	].join(" "),
	popover: [
		"min-w-[150px] rounded-lg p-1 outline-none",
		"bg-(--color-background) border border-(--color-border) shadow-lg",
		"data-[entering]:animate-in data-[entering]:fade-in",
		"data-[exiting]:animate-out data-[exiting]:fade-out duration-150",
	].join(" "),
	menu: "outline-none",
	item: [
		"flex cursor-pointer items-center rounded px-3 py-1.5 text-sm text-(--color-text) outline-none transition-colors",
		"data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
		"data-[focused]:bg-(--color-background-muted)",
		"data-[selected]:font-medium data-[selected]:text-(--color-primary)",
	].join(" "),
})
