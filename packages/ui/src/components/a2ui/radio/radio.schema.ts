import { z } from "zod"
import { groupSchemaFields } from "../group-schema-fields.ts"

export const RadioSchema = z.object({
	type: z.literal("Radio"),
	props: z
		.object({
			label: z.string().optional(),
			value: z.string(),
			isDisabled: z.boolean().optional(),
		})
		.strict()
		.optional(),
})

export type RadioNode = z.infer<typeof RadioSchema>

export const RadioGroupSchema = z.object({
	type: z.literal("RadioGroup"),
	props: z
		.object({
			label: z.string().optional(),
			value: z.string().optional(),
			defaultValue: z.string().optional(),
			...groupSchemaFields,
		})
		.strict()
		.optional(),
	children: z.array(RadioSchema).optional(),
})

export type RadioGroupNode = z.infer<typeof RadioGroupSchema>
