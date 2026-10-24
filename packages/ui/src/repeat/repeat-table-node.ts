/**
 * The render-time node types the table presentation expands to, and the strings they
 * are built from (ADR-42, ADR-43).
 *
 * React-free and dependency-free on purpose, like `repeat-node.ts`: a `"use server"`
 * module may import the vocabulary, and a Server Component must not pull a client
 * component into its graph through a transitive import.
 *
 * There is a node type per cell because a native `<table>` has a fixed element
 * nesting and the a2ra renderer adds no wrapper of its own, which is also what makes
 * the cell count structural: a member control hidden in one instance leaves its cell
 * behind, empty, instead of shortening that row and shearing the column off its
 * header.
 *
 * All of them exist only after {@link repeatTableNode} has run, so the stored bytes
 * never carry one.
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
 * One cell input's own label: the row first, then the column.
 *
 * It is the only encoding of a cell's name that survives both layouts, which is why
 * every cell carries a real `<label>`: `scope` and `headers` serve 1.3.1 for the
 * table's structure but are not claimed to name the input, and at the card reflow the
 * header cells stop being headers altogether.
 *
 * The row comes first because APG's naming practice puts the distinguishing words
 * first: every cell in a column shares the column's label, and the row is what tells
 * one from another.
 */
export function cellLabelFor(rowLabel: string, columnLabel: string): string {
  if (rowLabel === "") return columnLabel;
  if (columnLabel === "") return rowLabel;
  return `${rowLabel}, ${columnLabel}`;
}

/**
 * The name of the row-header column, from the instance-label template with its `{n}`
 * removed: "Asset {n}" gives "Asset".
 *
 * The group's own label names the whole collection and is already the `<caption>`,
 * while this column holds one instance per row, so it is named for one. It is derived
 * here rather than carried in the stored props because the corner cell is render-time
 * markup and no stored byte has to grow for it.
 */
export function instanceNoun(instanceLabelTemplate: string): string {
  return instanceLabelTemplate.replaceAll("{n}", " ").replaceAll(/\s+/gu, " ").trim();
}

/**
 * The visually hidden name of the actions column, from the compiled `removeLabel`
 * template with its `{label}` placeholder removed.
 *
 * A column of Remove buttons needs a header cell, and an empty `<th>` is the one
 * thing it may not be: it tells a respondent reading the row nothing and axe reports
 * it. The wording comes from the same lexicon the buttons are named from, so there is
 * no second source for it to drift from.
 */
export function actionColumnLabel(removeLabelTemplate: string): string {
  return removeLabelTemplate.replaceAll("{label}", " ").replaceAll(/\s+/gu, " ").trim();
}

/**
 * The wording of the `<tfoot>` total's row header, keyed by the active locale's
 * language subtag with an English fallback.
 *
 * A render-time lexicon rather than part of the stored document, because a column
 * total is computed presentation: never an input, never posted, never stored, never
 * submitted and never exported, so a stored document has nothing to carry for it and
 * a foreign renderer that computes its own total names it in its own words.
 */
export const REPEAT_TABLE_LEXICON: { readonly en: { readonly total: string } } & Readonly<
  Record<string, { readonly total: string }>
> = {
  en: { total: "Total" },
};

/** The total row's header for this locale, falling back to English. */
export function totalLabelFor(locale: string): string {
  const language = locale.split("-")[0] ?? "";
  return (REPEAT_TABLE_LEXICON[language] ?? REPEAT_TABLE_LEXICON.en).total;
}
