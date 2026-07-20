export const getTextAreaStyles = () => ({
	container: "flex flex-col gap-2",
	label: "text-sm font-medium text-(--color-text)",
	textarea:
		"px-3 py-2.5 min-h-24 resize-y border border-(--color-border) rounded bg-(--color-background) text-(--color-text) placeholder-(--color-text-muted) focus:outline-none focus:ring-2 focus:ring-(--color-primary) focus:border-transparent disabled:bg-(--color-background-muted) disabled:cursor-not-allowed disabled:resize-none aria-[invalid]:border-(--color-danger) aria-[invalid]:focus:ring-(--color-danger)",
	description: "text-xs text-(--color-text-muted)",
	errorMessage: "text-xs text-(--color-danger)",
	requiredIndicator: "text-(--color-danger)",
})
