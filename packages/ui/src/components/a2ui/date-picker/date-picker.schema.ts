import { z } from "zod"

export const DatePickerSchema = z.object({
	type: z.literal("DatePicker"),
	props: z
		.object({
			label: z.string().optional(),
			name: z.string().optional(),
			description: z.string().optional(),
			errorMessage: z.string().optional(),
			isDisabled: z.boolean().optional(),
			isRequired: z.boolean().optional(),
			isInvalid: z.boolean().optional(),
			isReadOnly: z.boolean().optional(),
			autoFocus: z.boolean().optional(),
			isOpen: z.boolean().optional(),
			defaultOpen: z.boolean().optional(),
			granularity: z.enum(["day", "hour", "minute", "second"]).optional(),
			firstDayOfWeek: z.enum(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]).optional(),
			validationBehavior: z.enum(["aria", "native"]).optional(),
			value: z.string().optional(),
			defaultValue: z.string().optional(),
			minValue: z.string().optional(),
			maxValue: z.string().optional(),
		})
		.strict()
		.optional(),
})

export type DatePickerNode = z.infer<typeof DatePickerSchema>

export const DateRangePickerSchema = z.object({
	type: z.literal("DateRangePicker"),
	props: z
		.object({
			label: z.string().optional(),
			description: z.string().optional(),
			errorMessage: z.string().optional(),
			isDisabled: z.boolean().optional(),
			isRequired: z.boolean().optional(),
			isInvalid: z.boolean().optional(),
			isReadOnly: z.boolean().optional(),
			isOpen: z.boolean().optional(),
			defaultOpen: z.boolean().optional(),
			startName: z.string().optional(),
			endName: z.string().optional(),
			granularity: z.enum(["day", "hour", "minute", "second"]).optional(),
			firstDayOfWeek: z.enum(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]).optional(),
			allowsNonContiguousRanges: z.boolean().optional(),
			validationBehavior: z.enum(["aria", "native"]).optional(),
			value: z
				.object({
					start: z.string(),
					end: z.string(),
				})
				.strict()
				.optional(),
			defaultValue: z
				.object({
					start: z.string(),
					end: z.string(),
				})
				.strict()
				.optional(),
			minValue: z.string().optional(),
			maxValue: z.string().optional(),
		})
		.strict()
		.optional(),
})

export type DateRangePickerNode = z.infer<typeof DateRangePickerSchema>
