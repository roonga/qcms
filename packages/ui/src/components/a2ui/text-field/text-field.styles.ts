export const getTextFieldStyles = () => ({
	container: "flex flex-col gap-2",
	label: "text-sm font-medium text-(--color-text)",
	input:
		"px-3 py-2.5 border border-(--color-border) rounded bg-(--color-background) text-(--color-text) placeholder-(--color-text-muted) focus:outline-none focus:ring-2 focus:ring-(--color-primary) focus:border-transparent disabled:bg-(--color-background-muted) disabled:cursor-not-allowed aria-[invalid]:border-(--color-danger) aria-[invalid]:focus:ring-(--color-danger)",
	description: "text-xs text-(--color-text-muted)",
	errorMessage: "text-xs text-(--color-danger)",
	requiredIndicator: "text-(--color-danger)",
})
