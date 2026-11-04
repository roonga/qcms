import { t } from "../i18n/en.ts";

import { addOption, moveOption, textOf } from "./definition.ts";

import type { ChoiceOptionView } from "./types.ts";

// Pending rows hold no id; mint once only after a nonblank label becomes real content.
// Otherwise abandoned rows consume ids and empty-label ids become permanent, indistinguishable rule operands.

// index is the insertion boundary among committed options; pending rows cannot hold an optionId.
export interface PendingRow {
  readonly index: number;
  readonly label: string;
}

export interface OptionGridState {
  readonly options: readonly ChoiceOptionView[];
  readonly pending: PendingRow | undefined;
}

export interface GridRow {
  readonly optionId: string | undefined;
  readonly label: string;

  readonly index: number;
  readonly isPending: boolean;
  // Stable keys preserve the focused DOM node while reordering.
  readonly key: string;
}

function isBlank(label: string): boolean {
  return label.trim() === "";
}

// Reuse add and whole-record swaps so insertion cannot separate labels from their permanent ids.
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

// Drag and keyboard movement share whole-record swap semantics to preserve id ownership.
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

// Commit an existing pending row first; adjust the new boundary if that commit inserted ahead of it.
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

export function setPendingLabel(state: OptionGridState, label: string): OptionGridState {
  if (state.pending === undefined) return state;
  return { options: state.options, pending: { index: state.pending.index, label } };
}

export function abandonPendingRow(state: OptionGridState): OptionGridState {
  return { options: state.options, pending: undefined };
}

// Abandon blank pending rows without minting; an unnamed row is not yet an option.
export function commitPendingRow(state: OptionGridState): OptionGridState {
  const { pending, options } = state;
  if (pending === undefined) return state;
  if (isBlank(pending.label)) return { options, pending: undefined };
  return { options: insertOptionAt(options, pending.label, pending.index), pending: undefined };
}

// Compute focus restoration before commit, when the pending row is still distinguishable from committed neighbours.
export function committedIndexOf(state: OptionGridState): number | undefined {
  const { pending } = state;
  if (pending === undefined || isBlank(pending.label)) return undefined;
  return Math.max(0, Math.min(pending.index, state.options.length));
}

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
  // Keep one stable pending key so surrounding edits cannot rebuild its focused textarea.
  rows.splice(at, 0, {
    optionId: undefined,
    label: pending.label,
    index: at,
    isPending: true,
    key: "qcms-pending-option-row",
  });
  return rows;
}

export type OptionRowAction = "insertAbove" | "insertBelow" | "moveUp" | "moveDown" | "remove";

export interface OptionRowMenuItem {
  readonly action: OptionRowAction;
  readonly label: string;
  readonly isDisabled: boolean;
  readonly isDanger: boolean;
}

// Move items provide the single-pointer alternative required for dragging; keyboard arrows alone do not satisfy it.
// Disabled middle entries must not block reaching Remove. Include row identity in every accessible action name.
export function optionRowMenuItems(row: {
  readonly name: string;

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
      // Remove is disabled at one option, so menu removal cannot leave a list with no focusable row.
      label: t("questions.options.remove", { row: name }),
      isDisabled: row.total <= 1,
      isDanger: true,
    },
  ];
}
