export const getNumberFieldStyles = () => ({
	container: "flex flex-col gap-2",
	label: "text-sm font-medium text-(--color-text)",
	inputGroup:
		"flex items-center border border-(--color-border) rounded bg-(--color-background) focus-within:ring-2 focus-within:ring-(--color-primary) focus-within:border-transparent",
	input:
		"self-stretch flex-1 min-w-0 px-3 text-sm bg-transparent text-(--color-text) placeholder-(--color-text-muted) focus:outline-none disabled:cursor-not-allowed",
	stepper:
		"h-11 w-11 shrink-0 flex items-center justify-center text-(--color-text-muted) hover:text-(--color-text) hover:bg-(--color-background-muted) transition-colors outline-none first:rounded-l last:rounded-r focus-visible:outline-2 focus-visible:outline-(--color-primary) disabled:opacity-50 disabled:cursor-not-allowed select-none",
	divider: "w-px self-stretch bg-(--color-border)",
	description: "text-xs text-(--color-text-muted)",
	errorMessage: "text-xs text-(--color-danger)",
	requiredIndicator: "text-(--color-danger)",
})
