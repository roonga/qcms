import { z } from "zod"

export const TextFieldSchema = z.object({
	type: z.literal("TextField"),
	props: z
		.object({
			label: z.string().optional(),
			placeholder: z.string().optional(),
			type: z.enum(["text", "email", "password", "number", "tel", "url"]).optional(),
			name: z.string().optional(),
			value: z.string().optional(),
			defaultValue: z.string().optional(),
			isDisabled: z.boolean().optional(),
			isRequired: z.boolean().optional(),
			isReadOnly: z.boolean().optional(),
			isInvalid: z.boolean().optional(),
			autoFocus: z.boolean().optional(),
			autoComplete: z.string().optional(),
			inputMode: z.enum(["text", "numeric", "decimal", "email", "tel", "url", "search"]).optional(),
			validationBehavior: z.enum(["aria", "native"]).optional(),
			minLength: z.number().optional(),
			maxLength: z.number().optional(),
			pattern: z.string().optional(),
			description: z.string().optional(),
			errorMessage: z.string().optional(),
		})
		.strict()
		.optional(),
})

export type TextFieldNode = z.infer<typeof TextFieldSchema>
