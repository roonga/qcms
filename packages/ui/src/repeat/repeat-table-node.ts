/**
 * React-free and dependency-free like `repeat-node.ts`: a `"use server"` module may import the vocabulary and a
 * Server Component must not pull a client component into its graph. A node type per cell, because a native
 * `<table>` has fixed nesting and the a2ra renderer adds no wrapper, so a hidden member leaves its cell behind.
 * None ever reaches a stored document.
 */

/** The scroll box, caption, column headers and total footer: one per group. */
export const REPEAT_TABLE_NODE_TYPE = "RepeatTable";

/** One live instance as a `<tr>`, its `<th scope="row">` carrying the row label. */
export const REPEAT_ROW_NODE_TYPE = "RepeatRow";

/** One `<td>`: a member question's control, or nothing when a rule hid it here. */
export const REPEAT_CELL_NODE_TYPE = "RepeatCell";

/** The one column kind that carries figure-width digits and a `<tfoot>` total. */
export const NUMBER_CONTROL_NODE_TYPE = "NumberField";

/**
 * The row first, then the column, because APG naming puts the distinguishing words first. A real per-cell label
 * is the only naming that survives both layouts: `scope`/`headers` serve 1.3.1 but do not name the input, and
 * the card reflow stops header cells being headers.
 */
export function cellLabelFor(rowLabel: string, columnLabel: string): string {
  if (rowLabel === "") return columnLabel;
  if (columnLabel === "") return rowLabel;
  return `${rowLabel}, ${columnLabel}`;
}

/**
 * The row-header column's name, from the instance-label template with its `{n}`
 * removed. The group's own label is already the `<caption>`, and this column holds one
 * instance per row, so it is named for one. Derived here rather than stored, because
 * the corner cell is render-time markup.
 */
export function instanceNoun(instanceLabelTemplate: string): string {
  return instanceLabelTemplate.replaceAll("{n}", " ").replaceAll(/\s+/gu, " ").trim();
}

/**
 * The actions column's hidden name. An empty `<th>` is the one thing it may not be: it
 * tells a respondent reading the row nothing and axe reports it. Taken from the same
 * lexicon the buttons are named from, so there is no second source to drift from.
 */
export function actionColumnLabel(removeLabelTemplate: string): string {
  return removeLabelTemplate.replaceAll("{label}", " ").replaceAll(/\s+/gu, " ").trim();
}

/**
 * A render-time lexicon rather than part of the stored document, because a column total
 * is computed presentation: never an input, never posted, never stored, never exported.
 */
export const REPEAT_TABLE_LEXICON: { readonly en: { readonly total: string } } & Readonly<
  Record<string, { readonly total: string }>
> = {
  en: { total: "Total" },
};

/** Falls back to English. */
export function totalLabelFor(locale: string): string {
  const language = locale.split("-")[0] ?? "";
  return (REPEAT_TABLE_LEXICON[language] ?? REPEAT_TABLE_LEXICON.en).total;
}
