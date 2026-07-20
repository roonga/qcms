import { type DateValue, parseDate } from "@internationalized/date"
import {
	Button,
	DateInput,
	DateSegment,
	Group,
	Label,
	Popover,
	DateRangePicker as RACDateRangePicker,
	RangeCalendar,
} from "react-aria-components"
import { CalendarNavigation, PickerHelpText } from "./date-picker.shared"
import { getDatePickerStyles } from "./date-picker.styles"

interface DateRangePickerProps {
	readonly label?: string
	readonly description?: string
	readonly errorMessage?: string
	readonly isDisabled?: boolean
	readonly isRequired?: boolean
	readonly isInvalid?: boolean
	readonly isReadOnly?: boolean
	readonly isOpen?: boolean
	readonly defaultOpen?: boolean
	readonly startName?: string
	readonly endName?: string
	readonly granularity?: "day" | "hour" | "minute" | "second"
	readonly firstDayOfWeek?: "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat"
	readonly allowsNonContiguousRanges?: boolean
	readonly validationBehavior?: "aria" | "native"
	readonly validate?: (
		value: { start: DateValue; end: DateValue } | null,
	) => string | string[] | true | null | undefined
	readonly value?: { start: string; end: string }
	readonly defaultValue?: { start: string; end: string }
	readonly minValue?: string
	readonly maxValue?: string
	readonly onChange?: (value: { start: string; end: string }) => void
	readonly onOpenChange?: (isOpen: boolean) => void
}

export function DateRangePicker({
	label,
	description,
	errorMessage,
	isDisabled,
	isRequired,
	isInvalid,
	isReadOnly,
	isOpen,
	defaultOpen,
	startName,
	endName,
	granularity,
	firstDayOfWeek,
	allowsNonContiguousRanges,
	validationBehavior,
	validate,
	value,
	defaultValue,
	minValue,
	maxValue,
	onChange,
	onOpenChange,
}: DateRangePickerProps) {
	const styles = getDatePickerStyles()
	return (
		<RACDateRangePicker
			value={value ? { start: parseDate(value.start), end: parseDate(value.end) } : undefined}
			defaultValue={
				defaultValue ? { start: parseDate(defaultValue.start), end: parseDate(defaultValue.end) } : undefined
			}
			minValue={minValue ? parseDate(minValue) : undefined}
			maxValue={maxValue ? parseDate(maxValue) : undefined}
			isDisabled={isDisabled}
			isRequired={isRequired}
			isInvalid={isInvalid}
			isReadOnly={isReadOnly}
			isOpen={isOpen}
			defaultOpen={defaultOpen}
			startName={startName}
			endName={endName}
			granularity={granularity}
			allowsNonContiguousRanges={allowsNonContiguousRanges}
			validationBehavior={validationBehavior}
			validate={validate}
			onChange={
				onChange
					? (range) => range && onChange({ start: range.start.toString(), end: range.end.toString() })
					: undefined
			}
			onOpenChange={onOpenChange}
			className={styles.root}
		>
			{label && <Label className={styles.label}>{label}</Label>}
			<Group className={styles.group}>
				<DateInput slot="start" className={styles.input}>
					{(segment) => <DateSegment segment={segment} className={styles.segment} />}
				</DateInput>
				<span aria-hidden="true" className={styles.rangeSeparator}>
					–
				</span>
				<DateInput slot="end" className={styles.input}>
					{(segment) => <DateSegment segment={segment} className={styles.segment} />}
				</DateInput>
				<Button className={styles.button}>▼</Button>
			</Group>
			<PickerHelpText description={description} errorMessage={errorMessage} styles={styles} />
			<Popover className={styles.popover}>
				<RangeCalendar firstDayOfWeek={firstDayOfWeek} className={styles.calendar}>
					<CalendarNavigation styles={styles} />
				</RangeCalendar>
			</Popover>
		</RACDateRangePicker>
	)
}
