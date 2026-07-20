import { z } from "zod"

const SelectItemSchema = z
	.object({
		label: z.string(),
		value: z.string(),
		isDisabled: z.boolean().optional(),
	})
	.strict()

export const SelectSchema = z.object({
	type: z.literal("Select"),
	props: z
		.object({
			label: z.string().optional(),
			placeholder: z.string().optional(),
			items: z.array(SelectItemSchema).optional(),
			value: z.string().optional(),
			defaultValue: z.string().optional(),
			isDisabled: z.boolean().optional(),
			isRequired: z.boolean().optional(),
			isOpen: z.boolean().optional(),
			defaultOpen: z.boolean().optional(),
			disabledKeys: z.array(z.string()).optional(),
			isInvalid: z.boolean().optional(),
			validationBehavior: z.enum(["aria", "native"]).optional(),
			name: z.string().optional(),
			description: z.string().optional(),
			errorMessage: z.string().optional(),
		})
		.strict()
		.optional(),
})

export type SelectNode = z.infer<typeof SelectSchema>
export type SelectItem = z.infer<typeof SelectItemSchema>
