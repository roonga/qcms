import { z } from "zod"
import { A2NodeSchema } from "../../schema/index.ts"

export const FormSchema = z.object({
	type: z.literal("Form"),
	props: z
		.object({
			gap: z.enum(["sm", "md", "lg"]).optional(),
			validationBehavior: z.enum(["aria", "native"]).optional(),
			validationErrors: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
			action: z.string().optional(),
			method: z.enum(["get", "post"]).optional(),
			encType: z.enum(["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"]).optional(),
			autoComplete: z.enum(["on", "off"]).optional(),
			target: z.string().optional(),
		})
		.strict()
		.optional(),
	children: z.array(A2NodeSchema).optional(),
})

export type FormNode = z.infer<typeof FormSchema>
