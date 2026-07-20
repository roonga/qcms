import { useContext, useEffect } from "react"
import { FieldError, Label, TextArea as RACTextArea, TextField as RACTextField, Text } from "react-aria-components"
import { FormStateContext } from "../../form-state"
import { getTextAreaStyles } from "./text-area.styles"

interface TextAreaProps {
	readonly label?: string
	readonly placeholder?: string
	readonly name?: string
	readonly value?: string
	readonly defaultValue?: string
	readonly rows?: number
	readonly isDisabled?: boolean
	readonly isRequired?: boolean
	readonly isReadOnly?: boolean
	readonly isInvalid?: boolean
	readonly autoFocus?: boolean
	readonly autoComplete?: string
	readonly validationBehavior?: "aria" | "native"
	readonly validate?: (value: string) => string | string[] | true | null | undefined
	readonly minLength?: number
	readonly maxLength?: number
	readonly description?: string
	readonly errorMessage?: string
	readonly onChange?: (value: string) => void
}

export function TextArea({
	label,
	placeholder,
	name,
	value,
	defaultValue,
	rows,
	isDisabled = false,
	isRequired = false,
	isReadOnly = false,
	isInvalid = false,
	autoFocus,
	autoComplete,
	validationBehavior,
	validate,
	minLength,
	maxLength,
	description,
	errorMessage,
	onChange,
}: TextAreaProps) {
	const styles = getTextAreaStyles()
	const formCtx = useContext(FormStateContext)

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only seed
	useEffect(() => {
		const key = name ?? label
		if (defaultValue !== undefined && key) formCtx?.setValue(key, defaultValue)
	}, [])

	const handleChange = (v: string) => {
		const key = name ?? label
		if (key) formCtx?.setValue(key, v)
		onChange?.(v)
	}

	return (
		<RACTextField
			name={name}
			value={value}
			defaultValue={defaultValue}
			isDisabled={isDisabled}
			isRequired={isRequired}
			isReadOnly={isReadOnly}
			isInvalid={isInvalid}
			autoFocus={autoFocus}
			autoComplete={autoComplete}
			validationBehavior={validationBehavior}
			validate={validate}
			minLength={minLength}
			maxLength={maxLength}
			onChange={handleChange}
			className={styles.container}
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
			<RACTextArea placeholder={placeholder} rows={rows} className={styles.textarea} />
			<FieldError className={styles.errorMessage}>
				{({ validationErrors }) => errorMessage ?? validationErrors.join(", ")}
			</FieldError>
		</RACTextField>
	)
}
