import type { ReactNode } from "react"
import { Button, MenuItem, MenuTrigger, Popover, Menu as RACMenu, Separator } from "react-aria-components"
import { getMenuStyles } from "./menu.styles"

/**
 * A row that does something: an action, or a selectable choice.
 *
 * `label` is a `ReactNode` so a row can carry a glyph, an icon or a badge beside its
 * text. Give `textValue` whenever it is not plain text: React Aria types-to-select and
 * announces from that string, and it cannot read a node tree.
 */
export interface MenuActionEntry {
	readonly id: string
	readonly label: ReactNode
	readonly textValue?: string
	readonly isDisabled?: boolean
	/** Renders the row as a link, so it middle-clicks, opens in a tab and copies like one. */
	readonly href?: string
	readonly kind?: "item"
}

/** A rule between groups of rows. Not a stop for the arrow keys. */
export interface MenuSeparatorEntry {
	readonly id: string
	readonly kind: "separator"
}

export type MenuItemEntry = MenuActionEntry | MenuSeparatorEntry

/**
 * Per-slot class overrides, for a host with its own design language.
 *
 * A slot named here REPLACES that slot's default classes rather than being appended to
 * them. Appending would leave two sets of opinions on one element and let cascade order
 * decide which wins, which is the kind of styling a consumer cannot reason about; a
 * replacement is exactly what the consumer asked for and nothing else.
 *
 * This prop is deliberately absent from `MenuSchema`: an A2UI document describes what a
 * menu IS, and letting a document carry class names would make presentation part of the
 * data format.
 */
export interface MenuClassNames {
	readonly trigger?: string
	readonly popover?: string
	readonly menu?: string
	readonly item?: string
	readonly header?: string
	readonly separator?: string
}

interface MenuProps {
	readonly triggerLabel?: string
	/**
	 * Content for the trigger button, in place of the plain `triggerLabel` text: a glyph,
	 * an icon, an avatar. The button itself is still this component's, so the keyboard
	 * contract is unchanged. Pass `triggerLabel` alongside it - it becomes the button's
	 * `aria-label`, which is the only name an icon-only trigger has.
	 */
	readonly trigger?: ReactNode
	/**
	 * `aria-label` for the popup itself, so a menu is describable independently of whatever
	 * opened it.
	 *
	 * React Aria's `MenuTrigger` also points the popup at its trigger button with
	 * `aria-labelledby`, and that wins the accessible-name computation, so this is the name
	 * a tool reads when it looks at the attribute rather than the computed one. It is
	 * forwarded rather than fought: overriding React Aria's own labelling to win the
	 * computation would take a documented `role`/ARIA override this component has no reason
	 * to make, and the trigger's name is a correct name for the menu it opened.
	 */
	readonly menuLabel?: string
	/**
	 * A non-interactive block above the rows ("Signed in as ...").
	 *
	 * Rendered OUTSIDE `role="menu"`, and followed by a rule. It is a label for the menu,
	 * not a stop in it: a first arrow-down that lands on an inert row is worse than one
	 * that lands on the first real action.
	 */
	readonly header?: ReactNode
	readonly items?: MenuItemEntry[]
	readonly classNames?: MenuClassNames
	readonly placement?: "top" | "bottom" | "left" | "right"
	readonly isOpen?: boolean
	readonly selectionMode?: "none" | "single" | "multiple"
	readonly selectedKeys?: string[]
	readonly defaultSelectedKeys?: string[]
	readonly disabledKeys?: string[]
	readonly disallowEmptySelection?: boolean
	readonly onAction?: (key: string) => void
	readonly onSelectionChange?: (keys: string[]) => void
	readonly onClose?: () => void
	readonly onOpenChange?: (isOpen: boolean) => void
}

export function Menu({
	triggerLabel = "Options",
	trigger,
	menuLabel,
	header,
	items = [],
	classNames,
	placement = "bottom",
	isOpen,
	selectionMode,
	selectedKeys,
	defaultSelectedKeys,
	disabledKeys,
	disallowEmptySelection,
	onAction,
	onSelectionChange,
	onClose,
	onOpenChange,
}: MenuProps) {
	const styles = getMenuStyles()
	const separatorClass = classNames?.separator ?? styles.separator

	return (
		<MenuTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
			<Button
				className={classNames?.trigger ?? styles.trigger}
				{...(trigger !== undefined && { "aria-label": triggerLabel })}
			>
				{trigger ?? triggerLabel}
			</Button>
			<Popover placement={placement} className={classNames?.popover ?? styles.popover}>
				{header !== undefined && (
					<>
						<div className={classNames?.header ?? styles.header}>{header}</div>
						<Separator className={separatorClass} />
					</>
				)}
				<RACMenu
					{...(menuLabel !== undefined && { "aria-label": menuLabel })}
					onAction={(key) => onAction?.(key as string)}
					selectionMode={selectionMode}
					selectedKeys={selectedKeys}
					defaultSelectedKeys={defaultSelectedKeys}
					disabledKeys={disabledKeys}
					disallowEmptySelection={disallowEmptySelection}
					onSelectionChange={
						onSelectionChange
							? (selection) => {
									if (selection !== "all") onSelectionChange([...selection].map((k) => k as string))
								}
							: undefined
					}
					onClose={onClose}
					className={classNames?.menu ?? styles.menu}
				>
					{items.map((item) =>
						item.kind === "separator" ? (
							<Separator key={item.id} className={separatorClass} />
						) : (
							<MenuItem
								key={item.id}
								id={item.id}
								isDisabled={item.isDisabled}
								className={classNames?.item ?? styles.item}
								{...(item.href !== undefined && { href: item.href })}
								{...(item.textValue !== undefined && { textValue: item.textValue })}
							>
								{item.label}
							</MenuItem>
						),
					)}
				</RACMenu>
			</Popover>
		</MenuTrigger>
	)
}
