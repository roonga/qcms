import { useContext, useEffect } from "react"
import { FieldError, Input, Label, TextField as RACTextField, Text } from "react-aria-components"
import { FormStateContext } from "../../form-state"
import { getTextFieldStyles } from "./text-field.styles"

interface TextFieldProps {
	readonly label?: string
	readonly placeholder?: string
	readonly type?: "text" | "email" | "password" | "number" | "tel" | "url"
	readonly name?: string
	readonly value?: string
	readonly defaultValue?: string
	readonly isDisabled?: boolean
	readonly isRequired?: boolean
	readonly isReadOnly?: boolean
	readonly isInvalid?: boolean
	readonly autoFocus?: boolean
	readonly autoComplete?: string
	readonly inputMode?: "text" | "numeric" | "decimal" | "email" | "tel" | "url" | "search"
	readonly validationBehavior?: "aria" | "native"
	readonly validate?: (value: string) => string | string[] | true | null | undefined
	readonly minLength?: number
	readonly maxLength?: number
	readonly pattern?: string
	readonly description?: string
	readonly errorMessage?: string
	readonly onChange?: (value: string) => void
}

export function TextField({
	label,
	placeholder,
	type = "text",
	name,
	value,
	defaultValue,
	isDisabled = false,
	isRequired = false,
	isReadOnly = false,
	isInvalid = false,
	autoFocus,
	autoComplete,
	inputMode,
	validationBehavior,
	validate,
	minLength,
	maxLength,
	pattern,
	description,
	errorMessage,
	onChange,
}: TextFieldProps) {
	const styles = getTextFieldStyles()
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
			type={type}
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
			pattern={pattern}
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
			<Input placeholder={placeholder} inputMode={inputMode} className={styles.input} />
			<FieldError className={styles.errorMessage}>
				{({ validationErrors }) => errorMessage ?? validationErrors.join(", ")}
			</FieldError>
		</RACTextField>
	)
}
