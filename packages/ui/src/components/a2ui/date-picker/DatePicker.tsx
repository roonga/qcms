import { type DateValue, parseDate } from "@internationalized/date"
import { useContext, useEffect } from "react"
import {
	Button,
	Calendar,
	DateInput,
	DateSegment,
	Group,
	Label,
	Popover,
	DatePicker as RACDatePicker,
} from "react-aria-components"
import { FormStateContext } from "../../form-state"
import { CalendarNavigation, PickerHelpText } from "./date-picker.shared"
import { getDatePickerStyles } from "./date-picker.styles"

interface DatePickerProps {
	readonly label?: string
	readonly name?: string
	readonly description?: string
	readonly errorMessage?: string
	readonly isDisabled?: boolean
	readonly isRequired?: boolean
	readonly isInvalid?: boolean
	readonly isReadOnly?: boolean
	readonly autoFocus?: boolean
	readonly isOpen?: boolean
	readonly defaultOpen?: boolean
	readonly granularity?: "day" | "hour" | "minute" | "second"
	readonly firstDayOfWeek?: "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat"
	readonly validationBehavior?: "aria" | "native"
	readonly validate?: (value: DateValue | null) => string | string[] | true | null | undefined
	readonly value?: string
	readonly defaultValue?: string
	readonly minValue?: string
	readonly maxValue?: string
	readonly onChange?: (value: string) => void
	readonly onOpenChange?: (isOpen: boolean) => void
}

export function DatePicker({
	label,
	name,
	description,
	errorMessage,
	isDisabled,
	isRequired,
	isInvalid,
	isReadOnly,
	autoFocus,
	isOpen,
	defaultOpen,
	granularity,
	firstDayOfWeek,
	validationBehavior,
	validate,
	value,
	defaultValue,
	minValue,
	maxValue,
	onChange,
	onOpenChange,
}: DatePickerProps) {
	const styles = getDatePickerStyles()
	const formCtx = useContext(FormStateContext)

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only seed
	useEffect(() => {
		if (defaultValue !== undefined && label) formCtx?.setValue(label, defaultValue)
	}, [])

	return (
		<RACDatePicker
			value={value ? parseDate(value) : undefined}
			defaultValue={defaultValue ? parseDate(defaultValue) : undefined}
			minValue={minValue ? parseDate(minValue) : undefined}
			maxValue={maxValue ? parseDate(maxValue) : undefined}
			name={name}
			isDisabled={isDisabled}
			isRequired={isRequired}
			isInvalid={isInvalid}
			isReadOnly={isReadOnly}
			autoFocus={autoFocus}
			isOpen={isOpen}
			defaultOpen={defaultOpen}
			granularity={granularity}
			validationBehavior={validationBehavior}
			validate={validate}
			onChange={(date) => {
				const v = date?.toString() ?? ""
				if (label) formCtx?.setValue(label, v)
				onChange?.(v)
			}}
			onOpenChange={onOpenChange}
			className={styles.root}
		>
			{label && <Label className={styles.label}>{label}</Label>}
			<Group className={styles.group}>
				<DateInput className={styles.input}>
					{(segment) => <DateSegment segment={segment} className={styles.segment} />}
				</DateInput>
				<Button className={styles.button}>▼</Button>
			</Group>
			<PickerHelpText description={description} errorMessage={errorMessage} styles={styles} />
			<Popover className={styles.popover}>
				<Calendar firstDayOfWeek={firstDayOfWeek} className={styles.calendar}>
					<CalendarNavigation styles={styles} />
				</Calendar>
			</Popover>
		</RACDatePicker>
	)
}
