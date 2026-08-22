import { t } from "../i18n/en.ts";

import { addOption, moveOption, textOf } from "./definition.ts";

import type { ChoiceOptionView } from "./types.ts";

/**
 * The option grid's editing state, as a pure state machine (task 057).
 *
 * ## Why a row can exist on screen before it exists in the document
 *
 * The frozen design card replaces the old "type a label, press Add option" pair with a
 * ghost add-row and with insert points between rows: the author asks for a row FIRST and
 * names it second. That reordering is the whole of this module's reason to exist, because
 * it collides with the one invariant the option list is built around.
 *
 * An `optionId` is minted once and never reused with a different meaning (R6). Under the
 * old editor the two moments coincided - the row and its id were both born from the label
 * in the add field - so nothing had to say which of them minting belonged to. Under the
 * card they are separated by however long the author spends typing, and something has to
 * decide.
 *
 * **The Code Owner's ruling (2026-08-06): the id is minted when the row first acquires
 * content, not when the ghost add-row is rendered.** The invariant is "minted once, never
 * editable", and that is about the id being stable for the life of a real option, not
 * about the moment of allocation. Minting on render would hand ids to rows the author
 * tabs past and abandons, producing gaps that mean nothing, and would make the ghost row a
 * thing that exists before the author said it should. Deferring keeps the id's lifetime
 * equal to the option's lifetime, which is what makes "never reused" meaningful.
 *
 * It also keeps ids **label-derived**, which is not a nicety: the rule builder shows raw
 * option ids as its picker labels with no lookup anywhere (`lib/forms/condition.ts` drops
 * labels entirely), so a question whose options minted from an empty ghost row would offer
 * an author `opt_option`, `opt_option_2`, `opt_option_3` and no way to tell them apart.
 * Ids are permanent, so that damage is not repairable after the fact.
 *
 * ## How the deferral is expressed, rather than remembered
 *
 * {@link PendingRow} has **no `optionId` field**. There is no expression in this module
 * that could give one to a row the author has not named, in the same way the shipped
 * editor has no input bound to an `optionId`. The only function that reaches minting is
 * {@link commitPendingRow}, and it reaches it only through `addOption`, and only when the
 * row carries a non-blank label. `option-grid.test.ts` asserts that a ghost row which is
 * opened and abandoned leaves the document byte-identical, which is the test that fails if
 * anyone later "simplifies" minting back to open time.
 *
 * ## Insert is the path that wants watching
 *
 * Append was always deferred by accident (there was nothing to mint from until the author
 * typed). Insert-between is new in this task, and it is the easy place to mint eagerly,
 * because the code that knows the insert position is sitting right beside a list it could
 * call `addOption` on. {@link openPendingRow} is deliberately the only door for both, so
 * insert cannot acquire its own minting path.
 */

/**
 * A row the author has opened but not yet named.
 *
 * Note what is absent: there is no `optionId` here, and that absence is the mechanism. A
 * pending row cannot carry an id because the shape has nowhere to put one.
 *
 * `index` is the position the row will occupy among the **committed** options once it is
 * named: 0 inserts before the first, `options.length` appends.
 */
export interface PendingRow {
  readonly index: number;
  readonly label: string;
}

/** The committed document plus the at-most-one row being named. */
export interface OptionGridState {
  readonly options: readonly ChoiceOptionView[];
  readonly pending: PendingRow | undefined;
}

/**
 * One row as the grid draws it, committed or not.
 *
 * `optionId` is `undefined` for exactly as long as the row is pending, which is what the
 * ID cell renders its placeholder from and what the component keys its behaviour off.
 */
export interface GridRow {
  readonly optionId: string | undefined;
  readonly label: string;
  /** Index into `options` for a committed row; the insert position for a pending one. */
  readonly index: number;
  readonly isPending: boolean;
  /** Stable React key, so a reorder relocates DOM nodes instead of rebuilding them. */
  readonly key: string;
}

/** A row whose label carries no usable text is not content, so it mints nothing. */
function isBlank(label: string): boolean {
  return label.trim() === "";
}

/**
 * Insert an option at `index` using only the sanctioned mutators.
 *
 * The task file is explicit that `addOption`/`moveOption`/`relabelOption`/`removeOption`
 * remain the only mutators, and no `addOptionAt` exists. It does not need to: appending
 * and then swapping the new tail backwards to `index` produces exactly the inserted array,
 * and every step is the shipped swap semantics, so an id can no more meet a different
 * label here than it can during an ordinary reorder. Option lists are a handful of rows,
 * so the quadratic shape is irrelevant and the guarantee is worth more than the loop.
 */
export function insertOptionAt(
  options: readonly ChoiceOptionView[],
  label: string,
  index: number,
): readonly ChoiceOptionView[] {
  const appended = addOption(options, label);
  const target = Math.max(0, Math.min(index, options.length));
  let next = appended;
  for (let at = appended.length - 1; at > target; at -= 1) {
    next = moveOption(next, at, -1);
  }
  return next;
}

/**
 * Move the option at `from` to `to`, again as a run of single-step swaps.
 *
 * Drag-to-position and Arrow Up/Down are the same operation at different granularity, so
 * both land here and both inherit `moveOption`'s guarantee rather than reimplementing it.
 */
export function moveOptionTo(
  options: readonly ChoiceOptionView[],
  from: number,
  to: number,
): readonly ChoiceOptionView[] {
  if (from < 0 || from >= options.length) return options;
  const target = Math.max(0, Math.min(to, options.length - 1));
  let next = options;
  for (let at = from; at !== target;) {
    const step = at < target ? 1 : -1;
    next = moveOption(next, at, step);
    at += step;
  }
  return next;
}

/**
 * Open a pending row at `index`. **Mints nothing.**
 *
 * A pending row already in flight commits first (it may have acquired content, and
 * content is an option), and the new row's index is shifted past it when that commit
 * inserted ahead of it.
 */
export function openPendingRow(state: OptionGridState, index: number): OptionGridState {
  const settled = commitPendingRow(state);
  const shift =
    state.pending !== undefined &&
    settled.options.length > state.options.length &&
    state.pending.index <= index
      ? 1
      : 0;
  const at = Math.max(0, Math.min(index + shift, settled.options.length));
  return { options: settled.options, pending: { index: at, label: "" } };
}

/** Type into the pending row. Still mints nothing: this is the whole point of deferring. */
export function setPendingLabel(state: OptionGridState, label: string): OptionGridState {
  if (state.pending === undefined) return state;
  return { options: state.options, pending: { index: state.pending.index, label } };
}

/**
 * Drop the pending row.
 *
 * The document is returned untouched, which is the observable form of "no id was
 * consumed": a row the author tabbed past and abandoned leaves the option list exactly as
 * it found it, and the next option the author does name gets the id its own label earns.
 */
export function abandonPendingRow(state: OptionGridState): OptionGridState {
  return { options: state.options, pending: undefined };
}

/**
 * Commit the pending row: **the only path in this module that reaches minting.**
 *
 * A blank row is abandoned rather than minted. That is the ruling applied literally - a
 * row with no content has not become an option - and it also closes the `opt_option` door
 * for good: the id fed to `addOption` from here is always a label the author typed.
 */
export function commitPendingRow(state: OptionGridState): OptionGridState {
  const { pending, options } = state;
  if (pending === undefined) return state;
  if (isBlank(pending.label)) return { options, pending: undefined };
  return { options: insertOptionAt(options, pending.label, pending.index), pending: undefined };
}

/**
 * The index the pending row's option lands at once committed, for focus restoration.
 *
 * The component needs this before the commit (to know which row to put focus back on) and
 * cannot read it afterwards, because a committed row is indistinguishable from its
 * neighbours by then.
 */
export function committedIndexOf(state: OptionGridState): number | undefined {
  const { pending } = state;
  if (pending === undefined || isBlank(pending.label)) return undefined;
  return Math.max(0, Math.min(pending.index, state.options.length));
}

/** The rows to draw, committed options with the pending row spliced in at its position. */
export function gridRows(state: OptionGridState): readonly GridRow[] {
  const rows: GridRow[] = state.options.map((option, index) => ({
    optionId: option.optionId,
    label: textOf(option.label),
    index,
    isPending: false,
    key: option.optionId,
  }));
  const { pending } = state;
  if (pending === undefined) return rows;
  const at = Math.max(0, Math.min(pending.index, rows.length));
  // One fixed key for the pending row, never an index: the row keeps its identity (and so
  // its focused textarea keeps focus) while options around it are committed or moved.
  rows.splice(at, 0, {
    optionId: undefined,
    label: pending.label,
    index: at,
    isPending: true,
    key: "qcms-pending-option-row",
  });
  return rows;
}

/**
 * What one entry of a row's grip menu does.
 *
 * The pin list's equivalent is `PinRowAction`, and the parallel name here would be
 * `OptionRowAction` - which contains the substring `onRowAction`, and so trips the scan in
 * `app/(shell)/table-anchors.test.tsx` that keeps the retired whole-row click handler from
 * coming back (issue 570). The `MenuAction` spelling says the same thing and stays out of
 * that gate's way.
 */
export type OptionRowMenuAction = "insertAbove" | "insertBelow" | "moveUp" | "moveDown" | "remove";

export interface OptionRowMenuItem {
  readonly action: OptionRowMenuAction;
  readonly label: string;
  readonly isDisabled: boolean;
  readonly isDanger: boolean;
}

/**
 * The five entries of an option row's grip menu.
 *
 * **Move up and Move down are not a convenience.** The grip reorders by pointer-drag, and
 * WCAG 2.2 SC 2.5.7 Dragging Movements (AA) asks that anything a drag can do is also
 * reachable with a single pointer and no dragging. The grip's Arrow Up/Down satisfies
 * SC 2.1.1 Keyboard, which is a different criterion and does not discharge 2.5.7: the
 * operator this is for is on a pointer they cannot drag with (a head pointer, a switch, an
 * eye tracker, a tremor), not on a keyboard. These two items are ordinary tap targets, and
 * they are that path. Removing either is a conformance regression rather than a
 * simplification, which is why the list is built here and asserted in `option-grid.test.ts`
 * instead of living inline in the component's JSX.
 *
 * The order is the one all three POCs draw (`plan/admin-shell-poc/admin-shell-poc.html`,
 * `settings-newquestion-poc.html`, `question-editor-poc.html`): the two inserts, the two
 * moves, then the destructive item last.
 *
 * **Disabled items now sit in the MIDDLE of this menu.** Move up is dead on the first row
 * and Move down on the last, at positions three and four of five. `components/row-menu.tsx`
 * skips disabled items wherever they sit (issue 517), so arrowing past one still reaches
 * Remove; that filter is what this ordering depends on.
 *
 * Every label names its row, because two rows' menus are otherwise five identical phrases.
 * The POCs write the move items as a bare "Move up" / "Move down"; the shipped app names
 * the row in every menu item it has (the pin list included), and a name that identifies the
 * row is worth more to the operator this change is for than matching the drawing's
 * shorthand.
 */
export function optionRowMenuItems(row: {
  /** The row's name, as the operator sees it: its label, or a positional fallback. */
  readonly name: string;
  /** 0-based position among the committed options. */
  readonly index: number;
  readonly total: number;
}): readonly OptionRowMenuItem[] {
  const name = row.name;
  return [
    {
      action: "insertAbove",
      label: t("questions.options.insertAbove", { row: name }),
      isDisabled: false,
      isDanger: false,
    },
    {
      action: "insertBelow",
      label: t("questions.options.insertBelow", { row: name }),
      isDisabled: false,
      isDanger: false,
    },
    {
      action: "moveUp",
      label: t("questions.options.moveUp", { row: name }),
      isDisabled: row.index <= 0,
      isDanger: false,
    },
    {
      action: "moveDown",
      label: t("questions.options.moveDown", { row: name }),
      isDisabled: row.index >= row.total - 1,
      isDanger: false,
    },
    {
      action: "remove",
      // The list can never empty from here: at one option Remove is dead, which is also why
      // the component's `removeAt` never needs a "focus the add row instead" case.
      label: t("questions.options.remove", { row: name }),
      isDisabled: row.total <= 1,
      isDanger: true,
    },
  ];
}
