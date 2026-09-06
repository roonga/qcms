import { useContext, useEffect, useId, useState, useSyncExternalStore } from "react"
import { FieldError, Input, Label, TextField as RACTextField, Text } from "react-aria-components"
import { FormStateContext } from "../../form-state"
import { getTextFieldStyles } from "./text-field.styles"

/** Nothing here ever changes, so the subscription is a noop. */
const subscribeToNothing = () => () => {}
const hydrationFinished = () => false
const stillHydrating = () => true

/**
 * Whether this render is the one attaching React to server-rendered markup.
 *
 * `useSyncExternalStore` answers from its server snapshot while a tree hydrates and from
 * its client snapshot on every render afterwards, which is the same mechanism React Aria's
 * own `useIsSSR` is built on. It is the only signal that separates "React is adopting
 * markup a browser has already been showing" from an ordinary client mount, and the
 * difference matters below: only the first case can have a value on screen that the
 * component does not yet know about.
 */
function useIsHydrating(): boolean {
	return useSyncExternalStore(subscribeToNothing, hydrationFinished, stillHydrating)
}

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
	const fieldId = useId()
	const isHydrating = useIsHydrating()

	// What the server-rendered input already holds, read once during the hydrating render
	// and before React can overwrite it.
	//
	// React Aria renders a CONTROLLED input whatever it is handed: `useTextField` always
	// puts `value` into `inputProps`, seeded from `defaultValue || ""`. So on a
	// server-rendered page the commit that attaches React writes that initial state onto
	// the DOM and silently discards whatever a person typed into the input while the
	// bundle was still downloading. On a `required` field the loss is worse than
	// cosmetic: the browser's own constraint validation then refuses the submit, with no
	// submit event, no request and no message.
	//
	// Only a value that DIFFERS from what the server rendered is adopted, so a page where
	// nobody typed early behaves exactly as before. A controlled field is left alone: its
	// value is the consumer's to decide, not the DOM's.
	const [hydratedValue] = useState<string | undefined>(() => {
		if (value !== undefined || !isHydrating || typeof document === "undefined") return undefined
		const element = document.getElementById(fieldId)
		if (!(element instanceof HTMLInputElement)) return undefined
		return element.value === (defaultValue ?? "") ? undefined : element.value
	})
	const initialValue = hydratedValue ?? defaultValue

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only seed
	useEffect(() => {
		const key = name ?? label
		if (initialValue !== undefined && key) formCtx?.setValue(key, initialValue)
	}, [])

	const handleChange = (v: string) => {
		const key = name ?? label
		if (key) formCtx?.setValue(key, v)
		onChange?.(v)
	}

	return (
		<RACTextField
			id={fieldId}
			type={type}
			name={name}
			value={value}
			defaultValue={initialValue}
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
