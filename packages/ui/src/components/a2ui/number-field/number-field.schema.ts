import { z } from "zod"

export const NumberFieldSchema = z.object({
	type: z.literal("NumberField"),
	props: z
		.object({
			label: z.string().optional(),
			placeholder: z.string().optional(),
			minValue: z.number().optional(),
			maxValue: z.number().optional(),
			step: z.number().optional(),
			value: z.number().optional(),
			defaultValue: z.number().optional(),
			isRequired: z.boolean().optional(),
			isDisabled: z.boolean().optional(),
			isReadOnly: z.boolean().optional(),
			isInvalid: z.boolean().optional(),
			isWheelDisabled: z.boolean().optional(),
			validationBehavior: z.enum(["aria", "native"]).optional(),
			name: z.string().optional(),
			description: z.string().optional(),
			errorMessage: z.string().optional(),
		})
		.strict()
		.optional(),
})

export type NumberFieldNode = z.infer<typeof NumberFieldSchema>
