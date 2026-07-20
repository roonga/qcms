import { z } from "zod"
import { A2NodeSchema } from "../../schema/index.ts"

export const FlexSchema = z.object({
	type: z.literal("Flex"),
	props: z
		.object({
			direction: z.enum(["row", "column", "row-reverse", "column-reverse"]).optional(),
			gap: z.enum(["none", "xs", "sm", "md", "lg", "xl"]).optional(),
			align: z.enum(["start", "center", "end", "stretch", "baseline"]).optional(),
			justify: z.enum(["start", "center", "end", "between", "around", "evenly"]).optional(),
			wrap: z.boolean().optional(),
		})
		.strict()
		.optional(),
	children: z.array(A2NodeSchema).optional(),
})

export type FlexNode = z.infer<typeof FlexSchema>

export const GridSchema = z.object({
	type: z.literal("Grid"),
	props: z
		.object({
			columns: z.number().int().min(1).max(12).optional(),
			gap: z.enum(["none", "xs", "sm", "md", "lg", "xl"]).optional(),
			align: z.enum(["start", "center", "end", "stretch"]).optional(),
		})
		.strict()
		.optional(),
	children: z.array(A2NodeSchema).optional(),
})

export type GridNode = z.infer<typeof GridSchema>
