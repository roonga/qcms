import { type CalendarDate, parseDate } from "@internationalized/date"
import {
	Button,
	CalendarCell,
	CalendarGrid,
	CalendarGridBody,
	CalendarGridHeader,
	CalendarHeaderCell,
	FieldError,
	Heading,
	Text,
} from "react-aria-components"
import type { getDatePickerStyles } from "./date-picker.styles"

type DatePickerStyles = ReturnType<typeof getDatePickerStyles>

/**
 * Parse an ISO day into a `CalendarDate`, or report "nothing selected" as `null`.
 *
 * `parseDate` throws on anything that is not a valid ISO day, so binding a value a
 * caller has not already validated would turn bad input into a render-time exception
 * rather than an empty control. Every empty spelling (`undefined`, `null`, `""`) and
 * every unparseable string resolves to `null`, which is react-aria's own spelling of
 * "no selection" and keeps the control controlled.
 */
export function parseDateOrNull(value: string | null | undefined): CalendarDate | null {
	if (!value) return null
	try {
		return parseDate(value)
	} catch {
		return null
	}
}

/**
 * The range counterpart of {@link parseDateOrNull}. A range is selected only when both
 * ends parse; a half-parseable range is no selection, never a partial one.
 */
export function parseDateRangeOrNull(
	range: { readonly start: string; readonly end: string } | null | undefined,
): { start: CalendarDate; end: CalendarDate } | null {
	if (!range) return null
	const start = parseDateOrNull(range.start)
	const end = parseDateOrNull(range.end)
	return start && end ? { start, end } : null
}

export function PickerHelpText({
	description,
	errorMessage,
	styles,
}: {
	readonly description?: string
	readonly errorMessage?: string
	readonly styles: DatePickerStyles
}) {
	return (
		<>
			{description && (
				<Text slot="description" className={styles.description}>
					{description}
				</Text>
			)}
			{errorMessage && <FieldError className={styles.error}>{errorMessage}</FieldError>}
		</>
	)
}

export function CalendarNavigation({ styles }: { readonly styles: DatePickerStyles }) {
	return (
		<>
			<header className={styles.calendarHeader}>
				<Button slot="previous" className={styles.navButton}>
					◀
				</Button>
				<Heading className={styles.calendarHeading} />
				<Button slot="next" className={styles.navButton}>
					▶
				</Button>
			</header>
			<CalendarGrid className={styles.grid}>
				<CalendarGridHeader>{(day) => <CalendarHeaderCell>{day}</CalendarHeaderCell>}</CalendarGridHeader>
				<CalendarGridBody>{(date) => <CalendarCell date={date} className={styles.cell} />}</CalendarGridBody>
			</CalendarGrid>
		</>
	)
}
