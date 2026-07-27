import { z } from "zod"
import { A2NodeSchema } from "../../schema/index.ts"

export const DialogSchema = z.object({
	type: z.literal("Dialog"),
	props: z
		.object({
			title: z.string().optional(),
			description: z.string().optional(),
			triggerLabel: z.string().optional(),
			isDismissable: z.boolean().optional(),
			isKeyboardDismissDisabled: z.boolean().optional(),
			role: z.enum(["dialog", "alertdialog"]).optional(),
			isOpen: z.boolean().optional(),
			defaultOpen: z.boolean().optional(),
		})
		.strict()
		.optional(),
	children: z.array(A2NodeSchema).optional(),
})

export type DialogNode = z.infer<typeof DialogSchema>
