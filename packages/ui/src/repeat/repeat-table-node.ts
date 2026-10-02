/**
 * The three render-time node types the **table presentation** expands to, and the
 * strings they are built from (task 077, ADR-42, ADR-43, plan section 4.5).
 *
 * This module is **React-free and dependency-free on purpose**, exactly as
 * `repeat-node.ts` and `native-submit.ts` are: a `"use server"` module may import
 * the vocabulary, and a Server Component must not pull a client component into its
 * graph through a transitive import.
 *
 * ## Why three node types and not one
 *
 * A native `<table>` has a fixed element nesting - `<tr>` inside `<tbody>`, `<th>`
 * and `<td>` inside `<tr>` - and the a2ra renderer renders a node's children as the
 * component's `children` with no wrapper of its own. So the only way to get a cell
 * element per column is a node per cell, and that is what makes the **cell count
 * structural**: a member control hidden in one instance by a per-instance rule
 * leaves its cell behind, empty, instead of shortening that row and shearing the
 * whole column off its header. One node per cell is the difference between an empty
 * cell and a broken table.
 *
 * All three exist only after {@link expandRepeatTable} has run, so the stored bytes
 * never carry one, exactly as `RepeatInstance` never reaches a stored document.
 */

/** The scroll box, caption, column headers and total footer: one per group. */
export const REPEAT_TABLE_NODE_TYPE = "RepeatTable";

/** One live instance as a `<tr>`, its `<th scope="row">` carrying the row label. */
export const REPEAT_ROW_NODE_TYPE = "RepeatRow";

/** One `<td>`: a member question's control, or nothing when a rule hid it here. */
export const REPEAT_CELL_NODE_TYPE = "RepeatCell";

/** The compiled control type a `number` question maps to, which is the one column
 * kind that carries figure-width digits and a `<tfoot>` total. */
export const NUMBER_CONTROL_NODE_TYPE = "NumberField";

/**
 * One cell input's own label: "Asset 3, Value AUD" - the row first, then the column.
 *
 * **This is the only encoding of a cell's name that survives both layouts, and that
 * is why every cell carries a real `<label>`** (plan section 4.5). `scope` and
 * `headers` associate a **cell** with its header cells, which serves 1.3.1 for the
 * table's structure; no source found claims they contribute to the **input's**
 * accessible name, and the input is what a respondent's assistive technology is on
 * while they type. Technique H44 and APG's naming practice ("Prefer Native
 * Techniques ... the HTML `label` element for form elements") are what name it. And
 * at the card reflow the header cells stop being headers altogether, so a name that
 * came from a header relationship goes with them.
 *
 * The row comes first because APG's naming practice puts the distinguishing words
 * first: every cell in a column shares the column's label, and the row is what tells
 * one from another. It is the same rule that makes the Remove control "Remove Asset
 * 3" and never "Asset 3 remove".
 */
export function cellLabelFor(rowLabel: string, columnLabel: string): string {
  if (rowLabel === "") return columnLabel;
  if (columnLabel === "") return rowLabel;
  return `${rowLabel}, ${columnLabel}`;
}

/**
 * The name of the row-header column, taken from the instance-label template with its
 * `{n}` removed: "Asset {n}" gives "Asset", so the corner cell reads "Asset".
 *
 * The group's own `label` names the whole collection ("Assets"), which is already the
 * `<caption>`; the column of row headers holds one instance each, so it is named for
 * one. This is the same derivation the compiler makes for the Add control's noun
 * (`addItemNoun` in `@roonga/qcms-a2ui-compiler`), and it is repeated here rather
 * than carried in the stored props because the corner cell is render-time markup and
 * no stored byte has to grow for it.
 *
 * A template with no `{n}` at all is legal (a group of one) and resolves to itself.
 */
export function instanceNoun(instanceLabelTemplate: string): string {
  return instanceLabelTemplate.replaceAll("{n}", " ").replaceAll(/\s+/gu, " ").trim();
}

/**
 * The visually hidden name of the actions column, from the compiled `removeLabel`
 * template with its `{label}` placeholder removed: "Remove {label}" gives "Remove".
 *
 * A column of Remove buttons needs a header cell, and an **empty** `<th>` is the one
 * thing it may not be: it tells a respondent reading the row nothing and axe reports
 * it. The wording comes from the same compiler lexicon the buttons themselves are
 * named from, so there is no second source for it to drift from.
 */
export function actionColumnLabel(removeLabelTemplate: string): string {
  return removeLabelTemplate.replaceAll("{label}", " ").replaceAll(/\s+/gu, " ").trim();
}

/**
 * The wording of the `<tfoot>` total's row header, keyed by the active locale's
 * language subtag with an English fallback.
 *
 * **A render-time lexicon, and that is the difference from `REPEAT_ACTION_LEXICON`
 * in the compiler.** The Add and Remove wording is part of the stored document,
 * because a renderer that is not ours has to read the control names out of the bytes
 * it was served. A column total is **computed presentation**: it is never an input,
 * never posted, never stored, never submitted and never exported, so there is nothing
 * about it for a stored document to carry, and a foreign renderer that computes its
 * own total names it in its own words. Putting it here also means the table
 * presentation moves no compiler stamp and regenerates no golden document.
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
