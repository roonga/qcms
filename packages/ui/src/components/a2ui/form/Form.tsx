import type { ReactNode } from "react"
import { Form as RACForm } from "react-aria-components"
import { getFormStyles } from "./form.styles"

interface FormProps {
	readonly gap?: "sm" | "md" | "lg"
	readonly validationBehavior?: "aria" | "native"
	readonly validationErrors?: Record<string, string | string[]>
	readonly action?: string
	readonly method?: "get" | "post"
	readonly encType?: "application/x-www-form-urlencoded" | "multipart/form-data" | "text/plain"
	readonly autoComplete?: "on" | "off"
	readonly target?: "_blank" | "_self" | "_parent" | "_top"
	readonly onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void
	readonly onReset?: (e: React.FormEvent<HTMLFormElement>) => void
	readonly onInvalid?: (e: React.FormEvent<HTMLFormElement>) => void
	readonly children?: ReactNode
}

export function Form({
	gap = "md",
	validationBehavior = "native",
	validationErrors,
	action,
	method,
	encType,
	autoComplete,
	target,
	onSubmit,
	onReset,
	onInvalid,
	children,
}: FormProps) {
	return (
		<RACForm
			action={action}
			method={method}
			encType={encType}
			autoComplete={autoComplete}
			target={target}
			validationBehavior={validationBehavior}
			validationErrors={validationErrors}
			onSubmit={onSubmit}
			onReset={onReset}
			onInvalid={onInvalid}
			className={getFormStyles(gap)}
		>
			{children}
		</RACForm>
	)
}
