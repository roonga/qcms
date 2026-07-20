const gapMap = {
	none: "gap-0",
	xs: "gap-1",
	sm: "gap-2",
	md: "gap-4",
	lg: "gap-6",
	xl: "gap-8",
}

const alignMap = {
	start: "items-start",
	center: "items-center",
	end: "items-end",
	stretch: "items-stretch",
	baseline: "items-baseline",
}

const justifyMap = {
	start: "justify-start",
	center: "justify-center",
	end: "justify-end",
	between: "justify-between",
	around: "justify-around",
	evenly: "justify-evenly",
}

const directionMap = {
	row: "flex-row",
	column: "flex-col",
	"row-reverse": "flex-row-reverse",
	"column-reverse": "flex-col-reverse",
}

const gridColsMap: Record<number, string> = {
	1: "grid-cols-1",
	2: "grid-cols-2",
	3: "grid-cols-3",
	4: "grid-cols-4",
	5: "grid-cols-5",
	6: "grid-cols-6",
	7: "grid-cols-7",
	8: "grid-cols-8",
	9: "grid-cols-9",
	10: "grid-cols-10",
	11: "grid-cols-11",
	12: "grid-cols-12",
}

export const getFlexStyles = (
	direction: "row" | "column" | "row-reverse" | "column-reverse" = "row",
	gap: "none" | "xs" | "sm" | "md" | "lg" | "xl" = "md",
	align: "start" | "center" | "end" | "stretch" | "baseline" = "stretch",
	justify: "start" | "center" | "end" | "between" | "around" | "evenly" = "start",
	wrap = false,
) =>
	[
		"flex",
		directionMap[direction],
		gapMap[gap],
		alignMap[align],
		justifyMap[justify],
		wrap ? "flex-wrap" : "flex-nowrap",
	].join(" ")

export const getGridStyles = (
	columns = 1,
	gap: "none" | "xs" | "sm" | "md" | "lg" | "xl" = "md",
	align: "start" | "center" | "end" | "stretch" = "start",
) => ["grid", gridColsMap[columns] ?? "grid-cols-1", gapMap[gap], alignMap[align]].join(" ")
