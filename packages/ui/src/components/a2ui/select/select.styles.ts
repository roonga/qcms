interface TriggerState {
	isDisabled?: boolean
	isInvalid?: boolean
}

const triggerBase =
	"flex w-full min-w-40 min-h-11 cursor-pointer items-center justify-between gap-2 rounded border px-3 py-2 text-sm transition-colors"

export const getSelectStyles = () => ({
	field: "flex flex-col gap-1",
	label: "text-sm font-medium text-(--color-text)",
	requiredIndicator: "text-(--color-danger)",
	trigger({ isDisabled, isInvalid }: TriggerState) {
		if (isDisabled) {
			return `${triggerBase} cursor-not-allowed border-(--color-border) bg-(--color-background-muted) opacity-50 text-(--color-text-muted)`
		}
		if (isInvalid) {
			return `${triggerBase} border-(--color-danger) bg-(--color-background) text-(--color-text)`
		}
		return `${triggerBase} border-(--color-border) bg-(--color-background) text-(--color-text) hover:border-(--color-primary)`
	},
	value: "flex-1 truncate text-left",
	placeholder: "text-(--color-text-muted)",
	chevron: "h-4 w-4 shrink-0 text-(--color-text-muted)",
	popover: "z-50 min-w-(--trigger-width) rounded border border-(--color-border) bg-(--color-background) p-1 shadow-md",
	listbox: "max-h-64 overflow-auto outline-none",
	item: "flex cursor-pointer items-center rounded px-3 py-1.5 text-sm text-(--color-text) outline-none transition-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[focused]:bg-(--color-background-muted) data-[selected]:font-medium data-[selected]:text-(--color-primary)",
	description: "text-xs text-(--color-text-muted)",
	errorMessage: "text-xs text-(--color-danger)",
})
