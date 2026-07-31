import { Button, MenuItem, MenuTrigger, Popover, Menu as RACMenu } from "react-aria-components"
import type { MenuItemEntry } from "./menu.schema"
import { getMenuStyles } from "./menu.styles"

interface MenuProps {
	readonly triggerLabel?: string
	readonly items?: MenuItemEntry[]
	readonly placement?: "top" | "bottom" | "left" | "right"
	readonly isOpen?: boolean
	readonly selectionMode?: "none" | "single" | "multiple"
	readonly selectedKeys?: string[]
	readonly defaultSelectedKeys?: string[]
	readonly disabledKeys?: string[]
	readonly onAction?: (key: string) => void
	readonly onSelectionChange?: (keys: string[]) => void
	readonly onClose?: () => void
	readonly onOpenChange?: (isOpen: boolean) => void
}

export function Menu({
	triggerLabel = "Options",
	items = [],
	placement = "bottom",
	isOpen,
	selectionMode,
	selectedKeys,
	defaultSelectedKeys,
	disabledKeys,
	onAction,
	onSelectionChange,
	onClose,
	onOpenChange,
}: MenuProps) {
	const styles = getMenuStyles()

	return (
		<MenuTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
			<Button className={styles.trigger}>{triggerLabel}</Button>
			<Popover placement={placement} className={styles.popover}>
				<RACMenu
					onAction={(key) => onAction?.(key as string)}
					selectionMode={selectionMode}
					selectedKeys={selectedKeys}
					defaultSelectedKeys={defaultSelectedKeys}
					disabledKeys={disabledKeys}
					onSelectionChange={
						onSelectionChange
							? (selection) => {
									if (selection !== "all") onSelectionChange([...selection].map((k) => k as string))
								}
							: undefined
					}
					onClose={onClose}
					className={styles.menu}
				>
					{items.map((item) => (
						<MenuItem key={item.id} id={item.id} isDisabled={item.isDisabled} className={styles.item}>
							{item.label}
						</MenuItem>
					))}
				</RACMenu>
			</Popover>
		</MenuTrigger>
	)
}
