import type { ReactNode } from "react"
import { useContext } from "react"
import { Button as RACButton } from "react-aria-components"
import { ActionContext } from "../../action-context"
import { getButtonStyles, getSizeStyles } from "./button.styles"

interface ButtonProps {
	readonly children?: ReactNode
	readonly isDisabled?: boolean
	readonly isPending?: boolean
	readonly type?: "button" | "reset" | "submit"
	readonly name?: string
	readonly value?: string
	readonly variant?: "primary" | "secondary" | "danger" | "ghost"
	readonly size?: "sm" | "md" | "lg"
	readonly onPress?: () => void
}

export function Button({
	children,
	isDisabled = false,
	isPending,
	type,
	name,
	value,
	variant = "primary",
	size = "md",
	onPress,
}: ButtonProps) {
	const actionCtx = useContext(ActionContext)

	const handlePress = actionCtx
		? () => {
				if (value) {
					actionCtx.fire(value)
				} else if (typeof children === "string") {
					actionCtx.fire(actionCtx.buildAction(children))
				} else {
					console.warn(
						"[A2Renderer] Button in action mode has neither a `value` nor string children; press will do nothing. Provide a `value` or string children.",
					)
				}
			}
		: onPress

	return (
		<RACButton
			onPress={handlePress}
			isDisabled={isDisabled}
			isPending={isPending}
			type={type}
			name={name}
			value={actionCtx ? undefined : value}
			className={`${getButtonStyles(variant)} ${getSizeStyles(size)}`}
		>
			{children}
		</RACButton>
	)
}
