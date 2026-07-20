import { z } from "zod"
import { groupSchemaFields } from "../group-schema-fields.ts"

export const CheckboxSchema = z.object({
	type: z.literal("Checkbox"),
	props: z
		.object({
			label: z.string().optional(),
			value: z.string().optional(),
			name: z.string().optional(),
			isSelected: z.boolean().optional(),
			defaultSelected: z.boolean().optional(),
			isDisabled: z.boolean().optional(),
			isRequired: z.boolean().optional(),
			isIndeterminate: z.boolean().optional(),
			isReadOnly: z.boolean().optional(),
			isInvalid: z.boolean().optional(),
			autoFocus: z.boolean().optional(),
			validationBehavior: z.enum(["aria", "native"]).optional(),
			errorMessage: z.string().optional(),
		})
		.strict()
		.optional(),
})

export type CheckboxNode = z.infer<typeof CheckboxSchema>

export const CheckboxGroupSchema = z.object({
	type: z.literal("CheckboxGroup"),
	props: z
		.object({
			label: z.string().optional(),
			value: z.array(z.string()).optional(),
			defaultValue: z.array(z.string()).optional(),
			...groupSchemaFields,
		})
		.strict()
		.optional(),
	children: z.array(CheckboxSchema).optional(),
})

export type CheckboxGroupNode = z.infer<typeof CheckboxGroupSchema>
