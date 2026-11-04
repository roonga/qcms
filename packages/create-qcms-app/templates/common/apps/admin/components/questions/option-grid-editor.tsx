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

/* Mint an option id only when the new option is named; later relabeling must never change or reuse it. */

type FocusRequest =
  | { readonly kind: "pending" }
  | { readonly kind: "label"; readonly index: number }
  | { readonly kind: "grip"; readonly index: number }
  | { readonly kind: "add" };

interface DragSession {
  readonly from: number;
  readonly pointerId: number;
  readonly startY: number;
  moved: boolean;
}

const DRAG_THRESHOLD = 4;

function findFocusTarget(
  body: HTMLUListElement | null,
  want: FocusRequest,
): HTMLElement | null | undefined {
  if (body === null) return null;
  if (want.kind === "pending") {
    return body.querySelector<HTMLElement>("[data-option-pending] textarea");
  }
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
  const revertRef = useRef<string>("");

  const state: OptionGridState = { options, pending };
  const rows = gridRows(state);

  function apply(next: OptionGridState): void {
    if (next.options !== options) onChange(next.options);
    setPending(next.pending);
  }

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

  function nameOf(row: GridRow, position: number): string {
    const label = row.label.trim();
    return label === "" ? t("questions.options.rowFallback", { position }) : label;
  }

  function openAt(index: number): void {
    apply(openPendingRow(state, index));
    setMenuAt(undefined);
    setFocusWant({ kind: "pending" });
  }

  function moveBy(row: GridRow, delta: -1 | 1): number | undefined {
    const settled = settle();
    const from = settled.at(row.index);
    const to = from + delta;
    if (to < 0 || to >= settled.options.length) return undefined;
    // No focus repair is needed for reorder: the permanent optionId key moves the same focused DOM node with
    // its option.
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

  /* Retain the menu reorder path as a non-dragging pointer alternative and focus the moved row's grip at its
     new index. */
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
    // Removal always focuses a neighboring grip; the menu forbids removing the last option.
    setFocusWant({ kind: "grip", index: Math.max(0, row.index - 1) });
  }

  function onGripPointerDown(row: GridRow, event: PointerEvent<HTMLButtonElement>): void {
    if (isFrozen || event.button !== 0) return;
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
      setMenuAt((open) => (open === row.index ? undefined : row.index));
      return;
    }
    if (landing === undefined) return;
    const settled = settle();
    const from = settled.at(session.from);
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

  function boundaryAt(clientY: number): number {
    const cells = bodyRef.current?.querySelectorAll<HTMLElement>("[data-option-index]") ?? [];
    let boundary = 0;
    for (const [index, cell] of [...cells].entries()) {
      const rect = cell.getBoundingClientRect();
      if (clientY > rect.top + rect.height / 2) boundary = index + 1;
    }
    return boundary;
  }

  function onGripKeyDown(row: GridRow, event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      moveBy(row, event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setMenuAt((open) => (open === row.index ? undefined : row.index));
    }
  }

  function onLabelKeyDown(row: GridRow, position: number, event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      if (row.isPending) setPending(setPendingLabel(state, revertRef.current).pending);
      else onChange(relabelOption(options, row.index, revertRef.current));
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (row.isPending) {
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

  function errorOf(row: GridRow): string | undefined {
    return row.isPending ? undefined : fieldError(issues, `options.${String(row.index)}.label`);
  }
  function errorIdOf(index: number): string {
    return `qcms-option-error-${String(index)}`;
  }

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
                {!isFrozen && !row.isPending && (
                  <button
                    type="button"
                    className="qcms-opt-insert"
                    aria-label={t("questions.options.insertAbove", { row: rowName })}
                    // Prevent blur before opening an insertion row; committing during pointer down could reflow another target
                    // under pointer up.
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
                        if (row.isPending) apply(commitPendingRow(state));
                      }}
                      onKeyDown={(event) => {
                        onLabelKeyDown(row, position + 1, event);
                      }}
                    />
                  </div>
                </div>

                {/* Render the minted id as text, never an input: permanent option identity cannot be edited. */}
                <div
                  className="qcms-opt-cell qcms-opt-cell--id"
                  {...(row.optionId === undefined
                    ? {
                        title: `${t("questions.options.idPending")}: ${t("questions.options.idPendingTitle")}`,
                      }
                    : {})}
                >
                  {row.optionId ?? (
                    <span className="qcms-opt-id--pending">{t("questions.options.idPending")}</span>
                  )}
                </div>
              </li>
            );
          })}
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
