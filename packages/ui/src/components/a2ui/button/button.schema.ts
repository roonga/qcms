import { z } from "zod"

export const ButtonSchema = z.object({
	type: z.literal("Button"),
	props: z
		.object({
			variant: z.enum(["primary", "secondary", "danger", "ghost"]).optional(),
			isDisabled: z.boolean().optional(),
			isPending: z.boolean().optional(),
			size: z.enum(["sm", "md", "lg"]).optional(),
			type: z.enum(["button", "reset", "submit"]).optional(),
			name: z.string().optional(),
			value: z.string().optional(),
		})
		.strict()
		.optional(),
	children: z.string().optional(),
})

export type ButtonNode = z.infer<typeof ButtonSchema>
