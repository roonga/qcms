import { useContext, useEffect } from "react"
import { Button, FieldError, Group, Input, Label, NumberField as RACNumberField, Text } from "react-aria-components"
import { FormStateContext } from "../../form-state"
import { getNumberFieldStyles } from "./number-field.styles"

interface NumberFieldProps {
	readonly label?: string
	readonly placeholder?: string
	readonly minValue?: number
	readonly maxValue?: number
	readonly step?: number
	readonly value?: number
	readonly defaultValue?: number
	readonly isRequired?: boolean
	readonly isDisabled?: boolean
	readonly isReadOnly?: boolean
	readonly isInvalid?: boolean
	readonly isWheelDisabled?: boolean
	readonly formatOptions?: Intl.NumberFormatOptions
	readonly validationBehavior?: "aria" | "native"
	readonly validate?: (value: number) => string | string[] | true | null | undefined
	readonly name?: string
	readonly description?: string
	readonly errorMessage?: string
	readonly onChange?: (value: number) => void
}

export function NumberField({
	label,
	placeholder,
	minValue,
	maxValue,
	step,
	value,
	defaultValue,
	isRequired = false,
	isDisabled = false,
	isReadOnly = false,
	isInvalid = false,
	isWheelDisabled,
	formatOptions,
	validationBehavior,
	validate,
	name,
	description,
	errorMessage,
	onChange,
}: NumberFieldProps) {
	const styles = getNumberFieldStyles()
	const formCtx = useContext(FormStateContext)

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only seed
	useEffect(() => {
		if (defaultValue !== undefined && label) formCtx?.setValue(label, `${defaultValue}`)
	}, [])

	const handleChange = (v: number) => {
		if (label) formCtx?.setValue(label, `${v}`)
		onChange?.(v)
	}

	return (
		<RACNumberField
			minValue={minValue}
			maxValue={maxValue}
			step={step}
			value={value}
			defaultValue={defaultValue}
			isRequired={isRequired}
			isDisabled={isDisabled}
			isReadOnly={isReadOnly}
			isInvalid={isInvalid}
			isWheelDisabled={isWheelDisabled}
			formatOptions={formatOptions}
			validationBehavior={validationBehavior}
			validate={validate}
			name={name}
			onChange={handleChange}
			className={styles.container}
		>
			{label && (
				<Label className={styles.label}>
					{label}
					{isRequired && <span className={styles.requiredIndicator}> *</span>}
				</Label>
			)}
			<Group className={styles.inputGroup}>
				<Button slot="decrement" className={styles.stepper}>
					−
				</Button>
				<span className={styles.divider} aria-hidden="true" />
				<Input placeholder={placeholder} className={styles.input} />
				<span className={styles.divider} aria-hidden="true" />
				<Button slot="increment" className={styles.stepper}>
					+
				</Button>
			</Group>
			{description && (
				<Text slot="description" className={styles.description}>
					{description}
				</Text>
			)}
			<FieldError className={styles.errorMessage}>
				{({ validationErrors }) => errorMessage ?? validationErrors.join(", ")}
			</FieldError>
		</RACNumberField>
	)
}
