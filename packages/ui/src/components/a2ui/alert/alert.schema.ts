import { z } from "zod"

export const AlertSchema = z.object({
	type: z.literal("Alert"),
	props: z
		.object({
			variant: z.enum(["info", "success", "warning", "error"]).optional(),
			title: z.string().optional(),
		})
		.strict()
		.optional(),
	children: z.string().optional(),
})

export type AlertNode = z.infer<typeof AlertSchema>
