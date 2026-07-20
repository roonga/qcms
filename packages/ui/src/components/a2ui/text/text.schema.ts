import { z } from "zod"

export const TextSchema = z.object({
	type: z.literal("Text"),
	props: z
		.object({
			as: z.enum(["h1", "h2", "h3", "h4", "p", "span", "label"]).optional(),
			size: z.enum(["xs", "sm", "md", "lg", "xl", "2xl"]).optional(),
			weight: z.enum(["normal", "medium", "semibold", "bold"]).optional(),
			color: z.enum(["default", "muted", "primary", "danger"]).optional(),
			align: z.enum(["left", "center", "right", "justify"]).optional(),
			italic: z.boolean().optional(),
			truncate: z.boolean().optional(),
		})
		.strict()
		.optional(),
	children: z.string().optional(),
})

export type TextNode = z.infer<typeof TextSchema>
