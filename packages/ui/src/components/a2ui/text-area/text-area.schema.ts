import { z } from "zod"

export const TextAreaSchema = z.object({
	type: z.literal("TextArea"),
	props: z
		.object({
			label: z.string().optional(),
			placeholder: z.string().optional(),
			name: z.string().optional(),
			value: z.string().optional(),
			defaultValue: z.string().optional(),
			rows: z.number().int().positive().optional(),
			isDisabled: z.boolean().optional(),
			isRequired: z.boolean().optional(),
			isReadOnly: z.boolean().optional(),
			isInvalid: z.boolean().optional(),
			autoFocus: z.boolean().optional(),
			autoComplete: z.string().optional(),
			validationBehavior: z.enum(["aria", "native"]).optional(),
			minLength: z.number().optional(),
			maxLength: z.number().optional(),
			description: z.string().optional(),
			errorMessage: z.string().optional(),
		})
		.strict()
		.optional(),
})

export type TextAreaNode = z.infer<typeof TextAreaSchema>
