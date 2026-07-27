import { z } from "zod"
import { A2NodeSchema } from "../../schema/index.ts"

export const CardSchema = z.object({
	type: z.literal("Card"),
	props: z
		.object({
			padding: z.enum(["none", "sm", "md", "lg"]).optional(),
			shadow: z.enum(["none", "sm", "md", "lg"]).optional(),
			radius: z.enum(["none", "sm", "md", "lg"]).optional(),
			border: z.boolean().optional(),
		})
		.strict()
		.optional(),
	children: z.array(A2NodeSchema).optional(),
})

export type CardNode = z.infer<typeof CardSchema>
