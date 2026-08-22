"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { RowMenu } from "@/components/row-menu";
import { announce } from "@/lib/announce";
import { t } from "@/lib/i18n/en";
import { relabelOption, removeOption } from "@/lib/questions/definition";
import { fieldError } from "@/lib/questions/errors";
import {
  commitPendingRow,
  gridRows,
  moveOptionTo,
  openPendingRow,
  optionRowMenuItems,
  setPendingLabel,
  type GridRow,
  type OptionGridState,
  type OptionRowAction,
  type PendingRow,
} from "@/lib/questions/option-grid";
import type { ChoiceOptionView, DefinitionIssue } from "@/lib/questions/types";

/**
 * The option grid: inline-editable table rows for the two choice types (task 057).
 *
 * This replaces 032's stacked-field list with the frozen design card
 * `plan/admin-theme/ds-option-grid.html`: rows in a grid, the cell IS the input, a ghost
 * add-row, hover- and focus-revealed row controls, insert points between rows, and drag or
 * Arrow Up/Down to reorder. It is a **presentation rebuild**. Every mutation still goes
 * through the same `definition.ts` helpers the old editor used, and the wire payload an
 * add, relabel, remove or reorder produces is byte-identical to the one it produced before.
 *
 * ## The invariant, and where it now lives
 *
 * An `optionId` is minted once and never reused with a different meaning (R6). The old
 * editor made that structural in one place - no input is bound to an `optionId` - and that
 * is still true here: the ID cell is a `<div>` of text, never a control, and it is not even
 * a focus target.
 *
 * The card moves the *other* half of it. Its ghost add-row is a button, so a row appears
 * before the author has typed a label, which separates "the row exists" from "the option is
 * named". The Code Owner ruled (2026-08-06) that minting belongs to the second moment:
 * `lib/questions/option-grid.ts` carries the reasoning and the guard tests, and this
 * component's only job is to never route around it. It does that by owning no minting of
 * its own - a pending row is `PendingRow` in local state, and the single path from there to
 * an `optionId` is `commitPendingRow`.
 *
 * ## Why the label cell is a bare `<textarea>` and not the vendored `TextField`
 *
 * The card is explicit that the cell is the input: no border at rest, so it reads as table
 * text until focused, and a textarea rather than an input so a long label wraps exactly as
 * the respondent will see it rather than scrolling out of sight. `TextField` renders its
 * own labelled, bordered field, and reaching that appearance would mean overriding its
 * chrome away - a second design language expressed as negations, which is worse than the
 * native element the card actually draws. So the cell is a `<textarea>` with a
 * visually-hidden `<label>`, which is what the card's own markup is. The row menu stays
 * deliberate about ADR-22 too, and `components/row-menu.tsx` says why it is hand-rolled.
 *
 * It grows with its content through the CSS "replicated content" trick rather than a resize
 * effect (`globals.css`, `.qcms-opt-label`): the wrapper repeats the value in an invisible
 * `::after` and both share a grid cell, so the row is the right height on the server's very
 * first paint instead of one frame later.
 *
 * ## The grip is three controls in one
 *
 * The card makes the grip the row's only control: pointer-drag to reorder, Arrow Up/Down to
 * reorder by keyboard, Enter or Space to open a menu carrying insert-above, insert-below,
 * move-up, move-down and remove. That absorbs a separate trailing remove button rather than
 * adding a second row-end target.
 *
 * The menu's two move items are the row's only reorder path for an operator on a pointer
 * that cannot drag (issue 680, WCAG 2.2 SC 2.5.7 Dragging Movements). `optionRowMenuItems`
 * in `lib/questions/option-grid.ts` builds and defends the list; the argument for why the
 * grip's arrow keys are not that path lives there.
 *
 * The popup itself is `components/row-menu.tsx`, which is where the ADR-22 argument for
 * hand-rolling it lives now. It moved there in issue 517, when the step editor's pin list
 * became the pattern's second caller: this file kept the drag session, the reorder keys and
 * the trigger, and handed over only the menu.
 *
 * ## Stale closures (issue #224)
 *
 * Every handler below reads `options` from props and `pending` from state on the render it
 * was created in, and none is memoized, so none can capture a stale document. The one place
 * that genuinely outlives a render is the pointer-drag session, and it keeps its state in a
 * ref precisely so it is read live rather than closed over.
 */

/** Which element the next render should put focus on. */
type FocusRequest =
  | { readonly kind: "pending" }
  | { readonly kind: "label"; readonly index: number }
  | { readonly kind: "grip"; readonly index: number }
  | { readonly kind: "add" };

/** A pointer-drag in flight. `moved` is what separates a drag from a click. */
interface DragSession {
  readonly from: number;
  readonly pointerId: number;
  readonly startY: number;
  moved: boolean;
}

/** How far a pointer must travel before a press on the grip counts as a drag, in px. */
const DRAG_THRESHOLD = 4;

/** Resolve a focus request against the rendered grid, or nothing if its row has gone. */
function findFocusTarget(
  body: HTMLUListElement | null,
  want: FocusRequest,
): HTMLElement | null | undefined {
  if (body === null) return null;
  if (want.kind === "pending") {
    return body.querySelector<HTMLElement>("[data-option-pending] textarea");
  }
  // The ghost add-row is a sibling of the list, not a row in it.
  if (want.kind === "add")
    return body.parentElement?.querySelector<HTMLElement>("[data-option-add]");
  const inner = want.kind === "label" ? "textarea" : "[data-option-grip]";
  return body.querySelector<HTMLElement>(`[data-option-index="${String(want.index)}"] ${inner}`);
}

export function OptionGridEditor({
  options,
  onChange,
  issues,
  isFrozen,
}: {
  readonly options: readonly ChoiceOptionView[];
  readonly onChange: (options: readonly ChoiceOptionView[]) => void;
  readonly issues: ReadonlyMap<string, DefinitionIssue[]>;
  readonly isFrozen: boolean;
}) {
  const [pending, setPending] = useState<PendingRow | undefined>(undefined);
  const [menuAt, setMenuAt] = useState<number | undefined>(undefined);
  const [drop, setDrop] = useState<{ readonly from: number; readonly at: number } | undefined>(
    undefined,
  );
  const [focusWant, setFocusWant] = useState<FocusRequest | undefined>(undefined);

  const bodyRef = useRef<HTMLUListElement>(null);
  const dragRef = useRef<DragSession | undefined>(undefined);
  /** The value a cell held when it took focus, which is what Escape reverts to. */
  const revertRef = useRef<string>("");

  const state: OptionGridState = { options, pending };
  const rows = gridRows(state);

  /** Push a new document to the parent and keep the local pending row in step. */
  function apply(next: OptionGridState): void {
    if (next.options !== options) onChange(next.options);
    setPending(next.pending);
  }

  /**
   * The document a structural change must act on, plus the translation its indices need.
   *
   * Any in-flight pending row commits first (it may carry content, and content is an
   * option), and that commit can insert ahead of the row being acted on - so a document
   * index taken from the render is translated across it rather than reused. Getting this
   * wrong moves or removes the row NEXT to the intended one, which reads as a drag glitch
   * and is actually an off-by-one.
   */
  function settle(): {
    readonly options: readonly ChoiceOptionView[];
    readonly at: (index: number) => number;
  } {
    const committed = commitPendingRow(state);
    const inserted = committed.options.length > options.length;
    const shifted = inserted && pending !== undefined;
    return {
      options: committed.options,
      at: (index) => (shifted && pending.index <= index ? index + 1 : index),
    };
  }

  /** Focus whatever the last action asked for, once the row it names exists. */
  useEffect(() => {
    if (focusWant === undefined) return;
    const body = bodyRef.current;
    const target = findFocusTarget(body, focusWant);
    target?.focus();
    if (focusWant.kind === "label" || focusWant.kind === "pending") {
      const field = target as HTMLTextAreaElement | null | undefined;
      field?.setSelectionRange(field.value.length, field.value.length);
    }
    setFocusWant(undefined);
  }, [focusWant]);

  /** An outside press closes the row menu, the way every menu is expected to. */
  useEffect(() => {
    if (menuAt === undefined) return;
    function close(event: globalThis.PointerEvent): void {
      const target = event.target;
      if (target instanceof Node && bodyRef.current?.contains(target) === true) return;
      setMenuAt(undefined);
    }
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
    };
  }, [menuAt]);

  /** The name a control uses for its row: the label, or a positional fallback. */
  function nameOf(row: GridRow, position: number): string {
    const label = row.label.trim();
    return label === "" ? t("questions.options.rowFallback", { position }) : label;
  }

  /** Open a pending row at a document position and put the caret in it. */
  function openAt(index: number): void {
    apply(openPendingRow(state, index));
    setMenuAt(undefined);
    setFocusWant({ kind: "pending" });
  }

  /** Move a row one place and answer where it landed, or nothing if it could not move. */
  function moveBy(row: GridRow, delta: -1 | 1): number | undefined {
    const settled = settle();
    const from = settled.at(row.index);
    const to = from + delta;
    if (to < 0 || to >= settled.options.length) return undefined;
    // No focus request: the row is keyed by its optionId, so React relocates the existing
    // DOM node rather than rebuilding it, and the grip the operator is holding travels
    // with it already focused. That is also what makes repeated presses move one option
    // several places instead of walking a fixed slot.
    apply({ options: moveOptionTo(settled.options, from, to), pending: undefined });
    announce(
      t("questions.options.moved", {
        row: nameOf(row, from + 1),
        position: to + 1,
        total: settled.options.length,
      }),
    );
    return to;
  }

  /**
   * Run one row-menu item.
   *
   * Move up and Move down are the reason this exists: they are the single-pointer,
   * non-dragging reorder path (SC 2.5.7), and unlike the grip's arrow keys they run with a
   * menu open over the row. So the menu closes and focus is placed deliberately, on the
   * moved row's grip at its NEW index - the operator's next press should be on the row they
   * just moved, wherever it went, rather than on whatever slid into the old slot.
   */
  function runAction(row: GridRow, action: OptionRowAction): void {
    if (action === "insertAbove") {
      openAt(row.index);
      return;
    }
    if (action === "insertBelow") {
      openAt(row.index + 1);
      return;
    }
    if (action === "remove") {
      removeAt(row);
      return;
    }
    const landed = moveBy(row, action === "moveUp" ? -1 : 1);
    setMenuAt(undefined);
    setFocusWant({ kind: "grip", index: landed ?? row.index });
  }

  function removeAt(row: GridRow): void {
    const settled = settle();
    apply({
      options: removeOption(settled.options, settled.at(row.index)),
      pending: undefined,
    });
    setMenuAt(undefined);
    // Somewhere deliberate, for the reason 032 recorded: a removed row takes the focused
    // element with it and the browser then drops focus to `<body>`, stranding a keyboard
    // operator at the top of the document with no announcement.
    // Always a neighbouring grip: the menu's Remove item is disabled at one option, so
    // the list can never empty here and there is no "focus the add row instead" case.
    setFocusWant({ kind: "grip", index: Math.max(0, row.index - 1) });
  }

  // ---------------------------------------------------------------- pointer drag

  function onGripPointerDown(row: GridRow, event: PointerEvent<HTMLButtonElement>): void {
    if (isFrozen || event.button !== 0) return;
    // Not the browser's text selection: dragging a row should not paint the page blue.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      from: row.index,
      pointerId: event.pointerId,
      startY: event.clientY,
      moved: false,
    };
  }

  function onGripPointerMove(event: PointerEvent<HTMLButtonElement>): void {
    const session = dragRef.current;
    if (session === undefined || session.pointerId !== event.pointerId) return;
    if (!session.moved && Math.abs(event.clientY - session.startY) < DRAG_THRESHOLD) return;
    session.moved = true;
    setMenuAt(undefined);
    setDrop({ from: session.from, at: boundaryAt(event.clientY) });
  }

  function onGripPointerUp(row: GridRow, event: PointerEvent<HTMLButtonElement>): void {
    const session = dragRef.current;
    dragRef.current = undefined;
    if (session === undefined || session.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const landing = drop;
    setDrop(undefined);
    if (!session.moved) {
      // A press that never travelled is a click, and a click on the row's one control
      // opens its menu. The pointer path has to reach insert, move and remove somehow, and
      // the card gives the row no second control to reach them by. That press is also the
      // whole of SC 2.5.7 here: a tap opens the menu, and a tap on Move up or Move down
      // reorders, with nothing dragged anywhere.
      setMenuAt((open) => (open === row.index ? undefined : row.index));
      return;
    }
    if (landing === undefined) return;
    const settled = settle();
    const from = settled.at(session.from);
    // A boundary index is "insert before this row", so landing below the source costs one.
    const boundary = settled.at(landing.at);
    const to = boundary > from ? boundary - 1 : boundary;
    if (to === from) return;
    apply({ options: moveOptionTo(settled.options, from, to), pending: undefined });
    announce(
      t("questions.options.moved", {
        row: nameOf(row, from + 1),
        position: to + 1,
        total: settled.options.length,
      }),
    );
  }

  /** The row boundary a pointer is nearest: 0 is above the first row, n below the last. */
  function boundaryAt(clientY: number): number {
    const cells = bodyRef.current?.querySelectorAll<HTMLElement>("[data-option-index]") ?? [];
    let boundary = 0;
    for (const [index, cell] of [...cells].entries()) {
      const rect = cell.getBoundingClientRect();
      if (clientY > rect.top + rect.height / 2) boundary = index + 1;
    }
    return boundary;
  }

  // ---------------------------------------------------------------- keyboard

  function onGripKeyDown(row: GridRow, event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      moveBy(row, event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      // Handled here rather than in a click handler so the button's own Enter/Space
      // activation cannot also fire and toggle the menu straight back shut.
      event.preventDefault();
      setMenuAt((open) => (open === row.index ? undefined : row.index));
    }
  }

  function onLabelKeyDown(row: GridRow, position: number, event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      // Revert to the value the cell held when it took focus, and stay in the cell.
      if (row.isPending) setPending(setPendingLabel(state, revertRef.current).pending);
      else onChange(relabelOption(options, row.index, revertRef.current));
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    // Enter commits and moves on, Confluence-style; Shift+Enter is left alone so a
    // deliberate newline inside a label is still typeable.
    event.preventDefault();
    if (row.isPending) {
      // Commit this one and open the next, which is the rhythm that makes naming five
      // options five labels and five Enters.
      const committed = commitPendingRow(state);
      apply(committed);
      if (committed.options.length > options.length) {
        setPending(openPendingRow(committed, row.index + 1).pending);
        setFocusWant({ kind: "pending" });
      }
      return;
    }
    const next = rows[position];
    if (next === undefined) setFocusWant({ kind: "add" });
    else if (next.isPending) setFocusWant({ kind: "pending" });
    else setFocusWant({ kind: "label", index: next.index });
  }

  // ---------------------------------------------------------------- render

  function errorOf(row: GridRow): string | undefined {
    return row.isPending ? undefined : fieldError(issues, `options.${String(row.index)}.label`);
  }
  function errorIdOf(index: number): string {
    return `qcms-option-error-${String(index)}`;
  }

  // The message line sits below the grid rather than inside the cell, as the card draws
  // it: a cell that is already a borderless input has nowhere to put a sentence without
  // pushing every other row around. The cell carries `aria-describedby` to it, so the two
  // are joined for an assistive technology even though they are apart on screen.
  const errorLines = rows
    .map((row, position) => ({ row, position: position + 1, message: errorOf(row) }))
    .filter(
      (line): line is { row: GridRow; position: number; message: string } =>
        typeof line.message === "string",
    );

  return (
    <fieldset className="qcms-fieldset">
      <legend className="qcms-fieldset__legend">{t("questions.options.legend")}</legend>
      <p className="text-sm text-(--color-text-muted)">{t("questions.options.note")}</p>

      <div className="qcms-opt-grid">
        {/* Decorative reinforcement for sighted readers, and out of the accessibility
            tree on purpose: every cell below already carries its own accessible name
            ("Option 2 label"), so the header adds nothing an assistive technology has
            not already been told, and adding it as table semantics would promise a grid
            widget this is not. */}
        <div className="qcms-opt-grid__head" aria-hidden="true">
          <div />
          <div>{t("questions.options.headLabel")}</div>
          <div>{t("questions.options.headId")}</div>
        </div>

        <ul ref={bodyRef} className="qcms-opt-grid__body">
          {rows.map((row, position) => {
            const rowName = nameOf(row, position + 1);
            const message = errorOf(row);
            const isDragging = drop !== undefined && !row.isPending && drop.from === row.index;
            const showDrop = drop !== undefined && drop.at === position;
            return (
              <li
                key={row.key}
                className={[
                  "qcms-opt-row",
                  isDragging ? "is-dragging" : "",
                  message === undefined ? "" : "is-error",
                ]
                  .filter(Boolean)
                  .join(" ")}
                {...(row.isPending
                  ? { "data-option-pending": "" }
                  : { "data-option-index": String(row.index) })}
              >
                {/* The insert point straddles this row's top edge. Hidden at rest,
                    revealed by hover OR focus so nothing here needs a pointer, and
                    always visible in high contrast. */}
                {!isFrozen && !row.isPending && (
                  <button
                    type="button"
                    className="qcms-opt-insert"
                    aria-label={t("questions.options.insertAbove", { row: rowName })}
                    // Keep focus where it is: a blur here would commit a pending row and
                    // reflow the list between this press's down and up, so the click would
                    // land on whatever slid underneath it. `openPendingRow` commits the
                    // in-flight row itself, in the right order.
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={() => {
                      openAt(row.index);
                    }}
                  >
                    <span className="qcms-opt-insert__line" aria-hidden="true" />
                    <span className="qcms-opt-insert__plus" aria-hidden="true">
                      +
                    </span>
                  </button>
                )}
                {/* The live drop indicator: the same line without the plus, because
                    nothing new is being created, a row is relocating. */}
                {showDrop && (
                  <div
                    className="qcms-opt-insert qcms-opt-insert--drop is-visible"
                    aria-hidden="true"
                  >
                    <span className="qcms-opt-insert__line" />
                  </div>
                )}

                <div className="qcms-opt-cell qcms-opt-cell--grip">
                  {!isFrozen && !row.isPending && (
                    <button
                      type="button"
                      data-option-grip=""
                      className="qcms-rowgrip"
                      aria-haspopup="menu"
                      aria-expanded={menuAt === row.index}
                      aria-label={t("questions.options.reorder", { row: rowName })}
                      onPointerDown={(event) => {
                        onGripPointerDown(row, event);
                      }}
                      onPointerMove={onGripPointerMove}
                      onPointerUp={(event) => {
                        onGripPointerUp(row, event);
                      }}
                      onKeyDown={(event) => {
                        onGripKeyDown(row, event);
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="9" cy="6" r="1.6" />
                        <circle cx="15" cy="6" r="1.6" />
                        <circle cx="9" cy="12" r="1.6" />
                        <circle cx="15" cy="12" r="1.6" />
                        <circle cx="9" cy="18" r="1.6" />
                        <circle cx="15" cy="18" r="1.6" />
                      </svg>
                    </button>
                  )}
                  {menuAt === row.index && (
                    <RowMenu
                      menuLabel={t("questions.options.rowActions", { row: rowName })}
                      items={optionRowMenuItems({
                        name: rowName,
                        index: row.index,
                        total: options.length,
                      }).map((item) => ({
                        key: item.action,
                        label: item.label,
                        isDisabled: item.isDisabled,
                        isDanger: item.isDanger,
                        onSelect: () => {
                          runAction(row, item.action);
                        },
                      }))}
                      onClose={() => {
                        setMenuAt(undefined);
                        setFocusWant({ kind: "grip", index: row.index });
                      }}
                    />
                  )}
                </div>

                <div className="qcms-opt-cell qcms-opt-cell--label">
                  <label className="qcms-visually-hidden" htmlFor={`qcms-option-${row.key}`}>
                    {t("questions.options.label", { position: position + 1 })}
                  </label>
                  {/* The wrapper repeats the value so the cell grows with it in CSS
                      alone; see `.qcms-opt-label` in globals.css. */}
                  <div className="qcms-opt-label" data-value={row.label}>
                    <textarea
                      id={`qcms-option-${row.key}`}
                      className="qcms-opt-label__input"
                      rows={1}
                      value={row.label}
                      disabled={isFrozen}
                      {...(message === undefined
                        ? {}
                        : { "aria-invalid": true, "aria-describedby": errorIdOf(row.index) })}
                      onFocus={(event) => {
                        revertRef.current = event.currentTarget.value;
                      }}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        if (row.isPending) setPending(setPendingLabel(state, value).pending);
                        else onChange(relabelOption(options, row.index, value));
                      }}
                      onBlur={() => {
                        // A pending row settles the moment focus leaves it: named, it
                        // becomes an option and mints its id; blank, it is abandoned and
                        // has consumed nothing.
                        if (row.isPending) apply(commitPendingRow(state));
                      }}
                      onKeyDown={(event) => {
                        onLabelKeyDown(row, position + 1, event);
                      }}
                    />
                  </div>
                </div>

                {/* Text, never an input, and never a focus target: this is where the
                    minted-once invariant is structural rather than remembered. */}
                <div
                  className="qcms-opt-cell qcms-opt-cell--id"
                  // The id itself goes in the tooltip as well as the cell. The card's ID
                  // column is 140px and ellipsizes, which was right for the opaque ids its
                  // mock showed (`opt_8f2ka91m`); the Code Owner's minting ruling keeps ids
                  // LABEL-DERIVED, so a real one (`opt_roadside_assistance`) overflows that
                  // width. An author writing a rule reads option ids raw, so this at least
                  // makes the whole one recoverable. Flagged for the screenshot gate: the
                  // column width is the card's call to revisit, not this task's to change.
                  title={
                    row.optionId ??
                    `${t("questions.options.idPending")}: ${t("questions.options.idPendingTitle")}`
                  }
                >
                  {row.optionId ?? (
                    <span className="qcms-opt-id--pending">{t("questions.options.idPending")}</span>
                  )}
                </div>
              </li>
            );
          })}
          {/* The end-of-list drop indicator has no row to hang from. */}
          {drop !== undefined && drop.at === rows.length && (
            <li className="qcms-opt-row qcms-opt-row--tail" aria-hidden="true">
              <div className="qcms-opt-insert qcms-opt-insert--drop is-visible">
                <span className="qcms-opt-insert__line" />
              </div>
            </li>
          )}
        </ul>

        {!isFrozen && (
          <button
            type="button"
            data-option-add=""
            className="qcms-opt-row--add"
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              openAt(options.length);
            }}
          >
            <span aria-hidden="true">+</span> {t("questions.options.add")}
          </button>
        )}
      </div>

      {errorLines.map(({ row, position, message }) => (
        <p key={row.key} id={errorIdOf(row.index)} className="qcms-opt-grid-error">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="8" y1="8" x2="16" y2="16" />
            <line x1="16" y1="8" x2="8" y2="16" />
          </svg>{" "}
          {t("questions.options.errorFor", { position, message })}
        </p>
      ))}
    </fieldset>
  );
}
