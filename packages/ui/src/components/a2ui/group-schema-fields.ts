import { z } from "zod"

export const groupSchemaFields = {
	isDisabled: z.boolean().optional(),
	isRequired: z.boolean().optional(),
	isReadOnly: z.boolean().optional(),
	isInvalid: z.boolean().optional(),
	validationBehavior: z.enum(["aria", "native"]).optional(),
	orientation: z.enum(["horizontal", "vertical"]).optional(),
	name: z.string().optional(),
	description: z.string().optional(),
	errorMessage: z.string().optional(),
}
