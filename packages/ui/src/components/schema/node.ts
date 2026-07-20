import { z } from "zod"

export type A2NodeInput = {
	type: string
	props?: Record<string, unknown>
	children?: A2NodeInput | A2NodeInput[] | string
}

// Generic envelope schema only — validates shape, not per-component props.
// Component schemas (ButtonSchema, TextFieldSchema, …) are separate and intended
// for consumer-side validation; they are deliberately not composed here so that
// A2NodeSchema stays open to unknown component types at render time.
export const A2NodeSchema: z.ZodType<A2NodeInput> = z.lazy(() =>
	z.object({
		type: z.string().min(1),
		props: z.record(z.string(), z.unknown()).optional(),
		children: z.union([A2NodeSchema, z.array(A2NodeSchema), z.string()]).optional(),
	}),
)

export function parseNode(input: unknown): A2NodeInput {
	return A2NodeSchema.parse(input)
}

export function safeParseNode(input: unknown): ReturnType<typeof A2NodeSchema.safeParse> {
	return A2NodeSchema.safeParse(input)
}
