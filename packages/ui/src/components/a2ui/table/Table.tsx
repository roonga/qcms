import { Cell, Column, Table as RACTable, Row, TableBody, TableHeader } from "react-aria-components"
import type { TableColumn, TableRow } from "./table.schema"
import { getTableStyles } from "./table.styles"

interface TableProps {
	readonly ariaLabel?: string
	readonly columns?: TableColumn[]
	readonly rows?: TableRow[]
	readonly selectionMode?: "none" | "single" | "multiple"
	readonly selectedKeys?: string[]
	readonly defaultSelectedKeys?: string[]
	readonly disabledKeys?: string[]
	readonly sortDescriptor?: { column: string; direction: "ascending" | "descending" }
	readonly onRowAction?: (id: string) => void
	readonly onSelectionChange?: (keys: string[]) => void
	readonly onSortChange?: (descriptor: { column: string; direction: "ascending" | "descending" }) => void
}

export function Table({
	ariaLabel = "Table",
	columns = [],
	rows = [],
	selectionMode = "none",
	selectedKeys,
	defaultSelectedKeys,
	disabledKeys,
	sortDescriptor,
	onRowAction,
	onSelectionChange,
	onSortChange,
}: TableProps) {
	const styles = getTableStyles()
	return (
		<RACTable
			aria-label={ariaLabel}
			selectionMode={selectionMode}
			selectedKeys={selectedKeys}
			defaultSelectedKeys={defaultSelectedKeys}
			disabledKeys={disabledKeys}
			sortDescriptor={sortDescriptor}
			onRowAction={(key) => onRowAction?.(key as string)}
			onSelectionChange={
				onSelectionChange
					? (selection) => {
							if (selection !== "all") onSelectionChange([...selection].map((k) => k as string))
						}
					: undefined
			}
			onSortChange={
				onSortChange
					? (descriptor) => onSortChange({ column: descriptor.column as string, direction: descriptor.direction })
					: undefined
			}
			className={styles.root}
		>
			<TableHeader>
				{columns.map((col) => (
					<Column key={col.id} id={col.id} isRowHeader={col.isRowHeader} className={styles.column}>
						{col.label}
					</Column>
				))}
			</TableHeader>
			<TableBody>
				{rows.map((row) => (
					<Row key={row.id} id={row.id} className={styles.row}>
						{columns.map((col) => (
							<Cell key={col.id} className={styles.cell}>
								{row.data[col.id] ?? ""}
							</Cell>
						))}
					</Row>
				))}
			</TableBody>
		</RACTable>
	)
}
