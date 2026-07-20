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
