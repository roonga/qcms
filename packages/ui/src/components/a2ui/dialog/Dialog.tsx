import type { ReactNode } from "react"
import { Button, DialogTrigger, Heading, Modal, ModalOverlay, Dialog as RACDialog, Text } from "react-aria-components"
import { getDialogStyles } from "./dialog.styles"

interface DialogProps {
	readonly title?: string
	readonly description?: string
	readonly triggerLabel?: string
	readonly isDismissable?: boolean
	readonly isKeyboardDismissDisabled?: boolean
	readonly role?: "dialog" | "alertdialog"
	readonly isOpen?: boolean
	readonly defaultOpen?: boolean
	readonly onOpenChange?: (isOpen: boolean) => void
	readonly children?: ReactNode
}

export function Dialog({
	title,
	description,
	triggerLabel,
	isDismissable = true,
	isKeyboardDismissDisabled,
	role = "dialog",
	isOpen,
	defaultOpen,
	onOpenChange,
	children,
}: DialogProps) {
	const styles = getDialogStyles()

	const dialogContent = (
		<>
			<div className={styles.header}>
				{title && (
					<Heading slot="title" className={styles.title}>
						{title}
					</Heading>
				)}
				<Button slot="close" aria-label="Close dialog" className={styles.closeButton}>
					<svg aria-hidden="true" width={16} height={16} viewBox="0 0 16 16" fill="none">
						<line x1={2} y1={2} x2={14} y2={14} stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
						<line x1={14} y1={2} x2={2} y2={14} stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
					</svg>
				</Button>
			</div>
			{description && (
				<Text slot="description" className={styles.description}>
					{description}
				</Text>
			)}
			{children && <div className={styles.body}>{children}</div>}
		</>
	)

	if (triggerLabel) {
		return (
			<DialogTrigger defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
				<Button className={styles.trigger}>{triggerLabel}</Button>
				<ModalOverlay
					isDismissable={isDismissable}
					isKeyboardDismissDisabled={isKeyboardDismissDisabled}
					className={styles.overlay}
				>
					<Modal className={styles.modal}>
						<RACDialog role={role} className={styles.dialog}>
							{dialogContent}
						</RACDialog>
					</Modal>
				</ModalOverlay>
			</DialogTrigger>
		)
	}

	return (
		<ModalOverlay
			isDismissable={isDismissable}
			isKeyboardDismissDisabled={isKeyboardDismissDisabled}
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			className={styles.overlay}
		>
			<Modal className={styles.modal}>
				<RACDialog role={role} className={styles.dialog}>
					{dialogContent}
				</RACDialog>
			</Modal>
		</ModalOverlay>
	)
}
