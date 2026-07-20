import { useContext, useEffect } from "react"
import {
	Button,
	FieldError,
	Label,
	ListBox,
	ListBoxItem,
	Popover,
	Select as RACSelect,
	SelectValue,
	Text,
} from "react-aria-components"
import { FormStateContext } from "../../form-state"
import type { SelectItem } from "./select.schema"
import { getSelectStyles } from "./select.styles"

interface SelectProps {
	readonly label?: string
	readonly placeholder?: string
	readonly items?: SelectItem[]
	readonly value?: string
	readonly defaultValue?: string
	readonly isDisabled?: boolean
	readonly isRequired?: boolean
	readonly isInvalid?: boolean
	readonly isOpen?: boolean
	readonly defaultOpen?: boolean
	readonly disabledKeys?: string[]
	readonly validationBehavior?: "aria" | "native"
	readonly validate?: (value: string) => string | string[] | true | null | undefined
	readonly name?: string
	readonly description?: string
	readonly errorMessage?: string
	readonly onChange?: (value: string) => void
	readonly onOpenChange?: (isOpen: boolean) => void
}

export function Select({
	label,
	placeholder = "Select an option",
	items = [],
	value,
	defaultValue,
	isDisabled = false,
	isRequired = false,
	isInvalid = false,
	isOpen,
	defaultOpen,
	disabledKeys,
	validationBehavior,
	validate,
	name,
	description,
	errorMessage,
	onChange,
	onOpenChange,
}: SelectProps) {
	const styles = getSelectStyles()
	const formCtx = useContext(FormStateContext)

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only seed
	useEffect(() => {
		const key = name ?? label
		if (defaultValue !== undefined && key) formCtx?.setValue(key, defaultValue)
	}, [])

	return (
		<RACSelect
			selectedKey={value}
			defaultSelectedKey={defaultValue}
			isDisabled={isDisabled}
			isRequired={isRequired}
			isInvalid={isInvalid}
			isOpen={isOpen}
			defaultOpen={defaultOpen}
			validationBehavior={validationBehavior}
			validate={validate ? (key) => validate(key as string) : undefined}
			name={name}
			placeholder={placeholder}
			onSelectionChange={(key) => {
				const v = key as string
				const fKey = name ?? label
				if (fKey) formCtx?.setValue(fKey, v)
				onChange?.(v)
			}}
			onOpenChange={onOpenChange}
			className={styles.field}
		>
			{label && (
				<Label className={styles.label}>
					{label}
					{isRequired && (
						<span aria-hidden="true" className={styles.requiredIndicator}>
							{" "}
							*
						</span>
					)}
				</Label>
			)}
			{description && (
				<Text slot="description" className={styles.description}>
					{description}
				</Text>
			)}
			<Button className={({ isDisabled: dis }) => styles.trigger({ isDisabled: dis, isInvalid })}>
				<SelectValue>
					{({ selectedText, isPlaceholder }) => (
						<span className={isPlaceholder ? styles.placeholder : styles.value}>
							{isPlaceholder ? placeholder : selectedText}
						</span>
					)}
				</SelectValue>
				<svg
					aria-hidden="true"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth={1.5}
					className={styles.chevron}
				>
					<path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			</Button>
			<FieldError className={styles.errorMessage}>{errorMessage}</FieldError>
			<Popover className={styles.popover}>
				<ListBox disabledKeys={disabledKeys} className={styles.listbox}>
					{items.map((item) => (
						<ListBoxItem key={item.value} id={item.value} isDisabled={item.isDisabled} className={styles.item}>
							{item.label}
						</ListBoxItem>
					))}
				</ListBox>
			</Popover>
		</RACSelect>
	)
}
