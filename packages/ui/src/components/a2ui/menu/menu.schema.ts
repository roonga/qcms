import { z } from "zod"

/**
 * A row that does something: an action, or a selectable choice.
 *
 * `textValue` is what React Aria types-to-select and announces from. It is only needed
 * when the rendered row is not plain text, which in an A2UI document it never is - it is
 * carried here so a JSON node and a code call describe the same row.
 */
const MenuActionItemSchema = z
	.object({
		id: z.string(),
		label: z.string(),
		textValue: z.string().optional(),
		isDisabled: z.boolean().optional(),
		href: z.string().optional(),
		kind: z.literal("item").optional(),
	})
	.strict()

/** A rule between groups of rows. It carries no label and is not a stop for the arrow keys. */
const MenuSeparatorItemSchema = z
	.object({
		id: z.string(),
		kind: z.literal("separator"),
	})
	.strict()

/**
 * Separator first, deliberately: it is the narrower shape, and an action row can never
 * satisfy it (`kind: "separator"` is required there and forbidden here by `.strict()`),
 * so the order decides nothing except which error a malformed row reports.
 */
const MenuItemSchema = z.union([MenuSeparatorItemSchema, MenuActionItemSchema])

export type MenuItemNode = z.infer<typeof MenuItemSchema>

export const MenuSchema = z.object({
	type: z.literal("Menu"),
	props: z
		.object({
			triggerLabel: z.string().optional(),
			menuLabel: z.string().optional(),
			items: z.array(MenuItemSchema).optional(),
			placement: z.enum(["top", "bottom", "left", "right"]).optional(),
			isOpen: z.boolean().optional(),
			selectionMode: z.enum(["none", "single", "multiple"]).optional(),
			selectedKeys: z.array(z.string()).optional(),
			defaultSelectedKeys: z.array(z.string()).optional(),
			disabledKeys: z.array(z.string()).optional(),
			disallowEmptySelection: z.boolean().optional(),
		})
		.strict()
		.optional(),
})

export type MenuNode = z.infer<typeof MenuSchema>
