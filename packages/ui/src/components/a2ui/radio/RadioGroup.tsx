import type { ReactNode } from "react"
import { useContext, useEffect } from "react"
import { FieldError, Label, RadioGroup as RACRadioGroup, Text } from "react-aria-components"
import { FormStateContext } from "../../form-state"
import { getRadioGroupStyles } from "./radio.styles"

interface RadioGroupProps {
	readonly label?: string
	readonly value?: string
	readonly defaultValue?: string
	readonly isDisabled?: boolean
	readonly isRequired?: boolean
	readonly isReadOnly?: boolean
	readonly isInvalid?: boolean
	readonly validationBehavior?: "aria" | "native"
	readonly validate?: (value: string) => string | string[] | true | null | undefined
	readonly orientation?: "horizontal" | "vertical"
	readonly name?: string
	readonly description?: string
	readonly errorMessage?: string
	readonly onChange?: (value: string) => void
	readonly children?: ReactNode
}

export function RadioGroup({
	label,
	value,
	defaultValue,
	isDisabled = false,
	isRequired = false,
	isReadOnly = false,
	isInvalid = false,
	validationBehavior,
	validate,
	orientation = "vertical",
	name,
	description,
	errorMessage,
	onChange,
	children,
}: RadioGroupProps) {
	const styles = getRadioGroupStyles()
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
		<RACRadioGroup
			value={value}
			defaultValue={defaultValue}
			isDisabled={isDisabled}
			isRequired={isRequired}
			isReadOnly={isReadOnly}
			isInvalid={isInvalid}
			validationBehavior={validationBehavior}
			validate={validate}
			orientation={orientation}
			name={name}
			onChange={handleChange}
			className={styles.group}
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
			<div className={styles.items(orientation)}>{children}</div>
			<FieldError className={styles.errorMessage}>{errorMessage}</FieldError>
		</RACRadioGroup>
	)
}
