import { z } from "zod"

const MenuItemSchema = z
	.object({
		id: z.string(),
		label: z.string(),
		isDisabled: z.boolean().optional(),
	})
	.strict()

export type MenuItemEntry = z.infer<typeof MenuItemSchema>

export const MenuSchema = z.object({
	type: z.literal("Menu"),
	props: z
		.object({
			triggerLabel: z.string().optional(),
			items: z.array(MenuItemSchema).optional(),
			placement: z.enum(["top", "bottom", "left", "right"]).optional(),
			isOpen: z.boolean().optional(),
			selectionMode: z.enum(["none", "single", "multiple"]).optional(),
			selectedKeys: z.array(z.string()).optional(),
			defaultSelectedKeys: z.array(z.string()).optional(),
			disabledKeys: z.array(z.string()).optional(),
		})
		.strict()
		.optional(),
})

export type MenuNode = z.infer<typeof MenuSchema>
