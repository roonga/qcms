interface IndicatorState {
	isSelected: boolean
	isIndeterminate: boolean
	isDisabled?: boolean
	isInvalid?: boolean
}

const indicatorBase = "w-4 h-4 shrink-0 rounded border-2 flex items-center justify-center transition-colors"

export const getCheckboxStyles = () => ({
	field: "flex flex-col gap-1",
	button: "flex items-center gap-2 text-sm text-(--color-text) cursor-pointer select-none",
	description: "text-xs text-(--color-text-muted)",
	errorMessage: "text-xs text-(--color-danger)",
	indicator({ isSelected, isIndeterminate, isDisabled, isInvalid }: IndicatorState) {
		if (isDisabled) {
			return `${indicatorBase} bg-(--color-background-muted) border-(--color-border) opacity-50`
		}
		if (isInvalid) {
			return `${indicatorBase} bg-(--color-background) border-(--color-danger)`
		}
		if (isSelected || isIndeterminate) {
			return `${indicatorBase} bg-(--color-primary) border-(--color-primary) text-(--color-primary-foreground)`
		}
		return `${indicatorBase} bg-(--color-background) border-(--color-border)`
	},
})

export const getCheckboxGroupStyles = () => ({
	group: "flex flex-col gap-2",
	label: "text-sm font-medium text-(--color-text)",
	requiredIndicator: "text-(--color-danger)",
	items: (orientation: "horizontal" | "vertical" = "vertical") =>
		orientation === "horizontal" ? "flex flex-row flex-wrap gap-4" : "flex flex-col gap-2",
	description: "text-xs text-(--color-text-muted)",
	errorMessage: "text-xs text-(--color-danger)",
})
