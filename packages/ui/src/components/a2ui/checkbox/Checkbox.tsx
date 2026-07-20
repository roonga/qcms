import { CheckboxButton, CheckboxField, FieldError } from "react-aria-components"
import { getCheckboxStyles } from "./checkbox.styles"

interface CheckboxProps {
	readonly label?: string
	readonly value?: string
	readonly name?: string
	readonly isSelected?: boolean
	readonly defaultSelected?: boolean
	readonly isDisabled?: boolean
	readonly isRequired?: boolean
	readonly isReadOnly?: boolean
	readonly isIndeterminate?: boolean
	readonly isInvalid?: boolean
	readonly autoFocus?: boolean
	readonly validationBehavior?: "aria" | "native"
	readonly validate?: (value: boolean) => string | string[] | true | null | undefined
	readonly errorMessage?: string
	readonly onChange?: (isSelected: boolean) => void
}

export function Checkbox({
	label,
	value,
	name,
	isSelected,
	defaultSelected,
	isDisabled = false,
	isRequired = false,
	isReadOnly = false,
	isIndeterminate = false,
	isInvalid = false,
	autoFocus,
	validationBehavior,
	validate,
	errorMessage,
	onChange,
}: CheckboxProps) {
	const styles = getCheckboxStyles()

	return (
		<CheckboxField
			value={value}
			name={name}
			isSelected={isSelected}
			defaultSelected={defaultSelected}
			isDisabled={isDisabled}
			isRequired={isRequired}
			isReadOnly={isReadOnly}
			isIndeterminate={isIndeterminate}
			isInvalid={isInvalid}
			autoFocus={autoFocus}
			validationBehavior={validationBehavior}
			validate={validate}
			onChange={onChange}
			className={styles.field}
		>
			<CheckboxButton
				className={({ isDisabled: dis, isInvalid: inv }) =>
					`${styles.button} ${dis ? "cursor-not-allowed opacity-50" : ""} ${inv ? "text-(--color-danger)" : ""}`
				}
			>
				{({ isSelected: sel, isIndeterminate: indet, isDisabled: dis, isInvalid: inv }) => (
					<>
						<div
							className={styles.indicator({ isSelected: sel, isIndeterminate: indet, isDisabled: dis, isInvalid: inv })}
						>
							{(sel || indet) && (
								<svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3">
									{indet ? (
										<rect x={1} y={5} width={10} height={2} fill="currentColor" />
									) : (
										<polyline
											points="1.5 6 4.5 9.5 10.5 2.5"
											fill="none"
											stroke="currentColor"
											strokeWidth={2}
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
									)}
								</svg>
							)}
						</div>
						{label}
					</>
				)}
			</CheckboxButton>
			<FieldError className={styles.errorMessage}>
				{({ validationErrors }) => errorMessage ?? validationErrors.join(", ")}
			</FieldError>
		</CheckboxField>
	)
}
