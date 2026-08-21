"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { EmptyState } from "@/components/empty-state";
import {
  Button,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MenuTriggerButton,
} from "@/components/kit";
import { RowMenu } from "@/components/row-menu";
import { announce } from "@/lib/announce";
import { messageForIssue, pinAnchorId } from "@/lib/forms/issues";
import {
  pinRowMenuItems,
  pinRows,
  pinStateLabel,
  type PinRowAction,
  type PinRowView,
} from "@/lib/forms/pin-grid";
import type { DraftForm, DraftStep, PinnableQuestion, FormIssue } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { textOf } from "@/lib/questions/definition";
import type { ReadState } from "@/lib/read-state";

import { LibraryPicker } from "./library-picker";

/**
 * One step's pinned questions, as the ownership grid (task 033; issue 517).
 *
 * ## Why this table is the one worth rebuilding
 *
 * `plan/admin-ux-audit.md` §8 item 5 calls this the highest-value design change in the
 * admin redesign, and the reason is ownership. This is the app's one genuinely **mixed**
 * table: a pin's position in the step and the version it points at belong to the FORM and
 * are editable right here, while `questionId`, `label` and `type` belong to the question
 * LIBRARY and cannot be changed from a form at all. What shipped before was a flex row of
 * five buttons and a menu, in which all five values looked equally like something you
 * could act on, and none of them said which.
 *
 * So the two kinds of cell are drawn as two kinds of thing, which is design-language
 * element 4: form-owned cells carry a control with a visible edge, library-owned cells
 * carry plain text. `lib/forms/pin-grid.ts` holds the split as data and every cell
 * repeats it in the markup as `data-owner`, which is what
 * `pin-grid-ownership.test.tsx` asserts - the contrast is the whole point of the change,
 * so it is pinned structurally rather than left to a screenshot.
 *
 * ## Every row still says `questionId` and its version, out loud
 *
 * That pair is the product's governance model, and it is why the row shows the id in
 * monospace rather than showing a friendly label with the version in a tooltip. An author
 * looking at this list can see, without opening anything, exactly which frozen definition
 * each question in this form will serve - the property that makes a questionnaire
 * reproducible years later (R6). The redesign splits the old single `q_x@1` string into
 * its two columns because the two halves have different owners, which is the same fact
 * stated more precisely, not a weaker one.
 *
 * **The id is rendered whole, which is a deliberate deviation from §2 as it stands.**
 * `plan/admin-design-contracts.md` §2's 2026-08-20 amendment asks an identifying column
 * for a type prefix plus 8 characters and never the full id. That clause is written for
 * opaque ids (`ses_45cf6345`, "nobody reads 32 hex characters"), and what makes it safe
 * there is a minting convention rather than the type: `ses_` and `lnk_` are 16 random
 * bytes, so they are uniformly 32 characters and a shorter one is self-evidently a
 * prefix. A `q_` id has no length convention at all. `packages/core/src/ids.ts` mints
 * every brand from one factory, so a truncation is itself a syntactically valid id of the
 * same kind: `q_at_fault_accident` cut to `q_at_faul` reads exactly like a whole short id,
 * and nothing stops a question actually called `q_at_faul` existing beside it tomorrow. A
 * reader cannot tell a truncation from a whole id by looking, which is the mistake the
 * clause's own anti-ellipsis rule exists to prevent.
 *
 * Stated as a deviation rather than as compliance, and with no precedent claimed: the
 * option grid still ellipsizes its `opt_` ids today (task 057 kept a 140px column with a
 * `title` tooltip and no copy control), so this is the first table to take this position
 * rather than the second. The clauses that DO apply are applied: monospace and tabular,
 * no ellipsis anywhere, and a copy control whose accessible name carries the entity and
 * the value. Raised for the Code Owner as a §2 clarification rather than decided here.
 *
 * ## The move menu is the only version change in the builder
 *
 * It moves **one pin** to **one version**, and the versions it offers are the published
 * ones. There is no "move everything to v3" and no automatic upgrade anywhere, and that
 * absence is the feature R7 protects: an author who published question v3 last week must
 * still see v2 here, because the alternative is a form whose meaning changed without
 * anyone deciding it should. A pin pointing at a version that has since been
 * **deprecated** keeps working and is flagged rather than fixed.
 *
 * ## Reorder, and what it is not
 *
 * The grip is the row's one control, exactly as the option grid's card draws it: Arrow
 * Up and Arrow Down reorder while it holds focus, Enter, Space or a click opens the row
 * menu. **There is no drag here**, deliberately. Drag would engage WCAG 2.2 SC 2.5.7
 * (Dragging Movements) and would need a single-pointer alternative, and the only new
 * control that would provide one is an editable position field, which the pattern this
 * issue applies does not have. The menu's Move up and Move down are already that path -
 * `plan/admin-mobile-stance.md` calls them "how reordering actually happens on the
 * supported path" - so adding a gesture that needs them as a fallback would add a
 * conformance obligation and no capability. Keyboard reorder satisfies SC 2.1.1 either
 * way, and it is preserved from the previous editor rather than replaced.
 *
 * ## A library that did not load says nothing about the pins (issues 572, 544)
 *
 * `library` is a `ReadState` (`lib/read-state.ts`), not an array, and it is passed
 * straight through to `pinRows` and to the picker rather than unwrapped here. Every
 * library-owned cell of this grid is a lookup, and an empty library is not a neutral
 * input to one: handed `ok ? data : []`, a failed read claimed on every row that the
 * library had no label, no type, no such version and nowhere else to move to.
 * `lib/forms/pin-grid.ts` carries the full account and the four answers.
 *
 * Nothing form-owned changes. The pins are still listed, and the grip menu, the version
 * menu, the keyboard reorder and the library button all still work: they edit the DRAFT,
 * which was read successfully, and suppressing them because a different read failed would
 * take away work an author can still do (`plan/admin-design-contracts.md` §3).
 */
export function StepEditor({
  draft,
  step,
  library,
  issues,
  onAddPin,
  onMovePin,
  onRemovePin,
  onReorderPin,
}: {
  readonly draft: DraftForm;
  readonly step: DraftStep;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly issues: readonly FormIssue[];
  /** `index` is an insert boundary: 0 is before the first pin, `items.length` appends. */
  readonly onAddPin: (questionId: string, version: number, index: number) => void;
  readonly onMovePin: (questionId: string, version: number) => void;
  readonly onRemovePin: (questionId: string) => void;
  readonly onReorderPin: (questionId: string, delta: -1 | 1) => void;
}) {
  /** The insert boundary the open picker would pin into, or nothing when it is closed. */
  const [pickerAt, setPickerAt] = useState<number | undefined>(undefined);
  const [menuAt, setMenuAt] = useState<number | undefined>(undefined);
  /** A grip to focus once the row it names exists, or "add" for the library button. */
  const [focusWant, setFocusWant] = useState<number | "add" | undefined>(undefined);

  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const addRef = useRef<HTMLDivElement>(null);

  const title = textOf(step.title) === "" ? t("forms.steps.untitled") : textOf(step.title);
  const rows = pinRows(step, library, issues);

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

  /**
   * Put focus where the last action asked for it.
   *
   * Removing a row takes the focused element with it and the browser then drops focus to
   * `<body>`, stranding a keyboard operator at the top of the document with no
   * announcement - the defect task 032 recorded for the option list and the same one
   * applies here. A neighbouring grip is the destination, or the library button when the
   * step has just emptied and there is no neighbour.
   */
  useEffect(() => {
    if (focusWant === undefined) return;
    const target =
      focusWant === "add"
        ? addRef.current?.querySelector<HTMLElement>("button")
        : bodyRef.current?.querySelector<HTMLElement>(
            `[data-pin-index="${String(focusWant)}"] [data-pin-grip]`,
          );
    target?.focus();
    setFocusWant(undefined);
  }, [focusWant]);

  function moveBy(row: PinRowView, delta: -1 | 1): void {
    const to = row.position + delta;
    if (to < 1 || to > row.total) return;
    onReorderPin(row.questionId, delta);
    announce(
      t("forms.step.pinMoved", {
        questionId: row.questionId,
        position: to,
        total: row.total,
      }),
    );
  }

  function removeRow(row: PinRowView): void {
    setMenuAt(undefined);
    onRemovePin(row.questionId);
    announce(t("forms.step.pinRemoved", { questionId: row.questionId }));
    setFocusWant(row.total <= 1 ? "add" : Math.max(0, row.position - 2));
  }

  function runAction(row: PinRowView, action: PinRowAction): void {
    if (action === "remove") {
      removeRow(row);
      return;
    }
    if (action === "moveUp" || action === "moveDown") {
      setMenuAt(undefined);
      setFocusWant(action === "moveUp" ? row.position - 2 : row.position);
      moveBy(row, action === "moveUp" ? -1 : 1);
      return;
    }
    setMenuAt(undefined);
    setPickerAt(action === "insertAbove" ? row.position - 1 : row.position);
  }

  function onGripKeyDown(row: PinRowView, event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      moveBy(row, event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      // Handled here rather than in a click handler so the button's own Enter/Space
      // activation cannot also fire and toggle the menu straight back shut.
      event.preventDefault();
      setMenuAt((open) => (open === row.position - 1 ? undefined : row.position - 1));
    }
  }

  return (
    <section
      aria-labelledby="qcms-step-heading"
      className="flex flex-col gap-4 rounded-md border border-(--color-border) bg-(--color-surface) p-4"
    >
      <h2 id="qcms-step-heading" className="text-base font-semibold text-(--color-text)">
        {t("forms.step.heading", { title })}
      </h2>
      <p className="text-sm text-(--color-text-muted)">{t("forms.step.pinNote")}</p>

      {rows.length === 0 ? (
        // `plan/admin-design-contracts.md` §3, and its 2026-08-20 amendment: the panel
        // carries no CTA here, because the creating action is the library button two
        // elements below it rather than a route this panel would have to point at.
        <EmptyState
          heading={t("forms.step.empty")}
          body={t("forms.step.emptyBody")}
          testId="qcms-step-empty"
        />
      ) : (
        <div className="qcms-table qcms-table--pins">
          <table>
            <caption className="qcms-visually-hidden">{t("forms.step.pins")}</caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="qcms-visually-hidden">{t("forms.step.column.reorder")}</span>
                </th>
                <th scope="col">{t("forms.step.column.question")}</th>
                {/* The two columns that DESCRIBE a row rather than identify it, which is
                    contract §2's own test for what may drop at compact width. Version
                    never drops: `plan/admin-mobile-stance.md` item 5 keeps changing a
                    version pin on the supported-at-390 path. */}
                <th scope="col" className="qcms-cell--drop">
                  {t("forms.step.column.type")}
                </th>
                <th scope="col" className="qcms-cell--num">
                  {t("forms.step.column.version")}
                </th>
                <th scope="col" className="qcms-cell--drop">
                  {t("forms.step.column.issues")}
                </th>
              </tr>
            </thead>
            <tbody ref={bodyRef}>
              {rows.map((row) => (
                <PinRow
                  key={row.questionId}
                  row={row}
                  isMenuOpen={menuAt === row.position - 1}
                  onGripKeyDown={(event) => {
                    onGripKeyDown(row, event);
                  }}
                  onGripClick={() => {
                    setMenuAt((open) => (open === row.position - 1 ? undefined : row.position - 1));
                  }}
                  onAction={(action) => {
                    runAction(row, action);
                  }}
                  onMenuClose={() => {
                    setMenuAt(undefined);
                    setFocusWant(row.position - 1);
                  }}
                  onMovePin={onMovePin}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div ref={addRef}>
        <Button
          variant="secondary"
          size="md"
          onPress={() => {
            setPickerAt(step.items.length);
          }}
        >
          {t("forms.step.addQuestion")}
        </Button>
      </div>

      {pickerAt !== undefined && (
        <LibraryPicker
          isOpen
          stepTitle={title}
          draft={draft}
          library={library}
          onPin={(questionId, version) => {
            onAddPin(questionId, version, pickerAt);
          }}
          onClose={() => {
            setPickerAt(undefined);
          }}
        />
      )}
    </section>
  );
}

/**
 * One row of the ownership grid.
 *
 * Each cell states its owner in `data-owner`. That attribute is not decoration: it is
 * how the ownership contrast is tested (`pin-grid-ownership.test.tsx` asserts that no
 * library-owned cell holds anything that could change its value, and that every
 * form-owned cell holds a control), so a later edit that drops a control into a
 * library-owned cell fails a test rather than quietly undoing the design.
 */
function PinRow({
  row,
  isMenuOpen,
  onGripKeyDown,
  onGripClick,
  onAction,
  onMenuClose,
  onMovePin,
}: {
  readonly row: PinRowView;
  readonly isMenuOpen: boolean;
  readonly onGripKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  readonly onGripClick: () => void;
  readonly onAction: (action: PinRowAction) => void;
  readonly onMenuClose: () => void;
  readonly onMovePin: (questionId: string, version: number) => void;
}) {
  const stateLabel = pinStateLabel(row.versionStatus);

  return (
    <tr
      className={row.issues.length > 0 ? "qcms-pinrow is-error" : "qcms-pinrow"}
      data-pin-index={row.position - 1}
      data-pin-question={row.questionId}
      data-pin-version={row.version}
    >
      {/* FORM-OWNED: the row's position in this step, changed from the grip. */}
      <td className="qcms-pincell--grip" data-owner="form">
        <button
          type="button"
          data-pin-grip=""
          className="qcms-rowgrip"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          aria-label={t("forms.step.rowActions", { questionId: row.questionId })}
          onKeyDown={onGripKeyDown}
          onClick={onGripClick}
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
        {isMenuOpen && (
          <RowMenu
            menuLabel={t("forms.step.rowActions", { questionId: row.questionId })}
            items={pinRowMenuItems(row).map((item) => ({
              key: item.action,
              label: item.label,
              isDisabled: item.isDisabled,
              isDanger: item.isDanger,
              onSelect: () => {
                onAction(item.action);
              },
            }))}
            onClose={onMenuClose}
          />
        )}
      </td>

      {/* LIBRARY-OWNED: what the question IS. Nothing here can be edited from a form,
          so nothing here is a control. The one button is the copy affordance contract
          §2 requires of an identifying column, and it changes no value. */}
      <th scope="row" className="qcms-pincell--question" data-owner="library">
        {/* Also the focus destination the validation panel's anchors send focus to, so
            an issue about this pin lands on the pin itself. It sits on the row header
            rather than on the id line because the id line is the part that could later
            be dropped at a narrow width; the row header cannot. */}
        <span
          id={pinAnchorId(row.questionId)}
          tabIndex={-1}
          className="qcms-pinrow__label"
          data-fallback={row.labelFallback}
        >
          {row.label}
        </span>
        <span className="qcms-pinrow__id">
          <span className="qcms-pinrow__idvalue">{row.questionId}</span>
          <CopyQuestionId questionId={row.questionId} />
        </span>
      </th>

      {/* LIBRARY-OWNED, and one of the two columns that drop at compact width. */}
      <td className="qcms-cell--drop" data-owner="library">
        {row.type}
      </td>

      {/* FORM-OWNED: the one version change the builder has (R7). */}
      <td className="qcms-pincell--version qcms-cell--num" data-owner="form">
        <MenuTrigger>
          <MenuTriggerButton
            aria-label={t("forms.step.movePin", { questionId: row.questionId })}
            className="qcms-pinversion"
          >
            {t("forms.step.pinVersion", { version: row.version })}
            <svg
              className="qcms-pinversion__caret"
              viewBox="0 0 10 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M1 1l4 4 4-4" />
            </svg>
          </MenuTriggerButton>
          <MenuPopover className="qcms-menu">
            <MenuList
              className="qcms-menu__list"
              aria-label={t("forms.step.movePin", { questionId: row.questionId })}
              onAction={(key) => {
                const version = Number.parseInt(String(key), 10);
                if (Number.isInteger(version)) onMovePin(row.questionId, version);
              }}
            >
              {/* "No other published version" is a statement about the LIBRARY, so it is
                  only sayable when the library was read. `undefined` is the read that
                  never happened, and it says that instead of reporting an absence its own
                  missing data produced (issue 572). */}
              {row.otherVersions === undefined ? (
                <MenuItem id="unknown" className="qcms-menu__item" isDisabled>
                  {t("forms.step.movePinUnknown")}
                </MenuItem>
              ) : row.otherVersions.length === 0 ? (
                <MenuItem id="none" className="qcms-menu__item" isDisabled>
                  {t("forms.step.movePinNone")}
                </MenuItem>
              ) : (
                row.otherVersions.map((version) => (
                  <MenuItem key={version} id={String(version)} className="qcms-menu__item">
                    {t("forms.step.movePinTo", { version })}
                  </MenuItem>
                ))
              )}
            </MenuList>
          </MenuPopover>
        </MenuTrigger>
        {stateLabel !== undefined && (
          <span
            className="qcms-tag qcms-tag--deprecated"
            data-pin-state={row.versionStatus ?? "missing"}
          >
            {stateLabel}
          </span>
        )}
      </td>

      {/* LIBRARY-OWNED: what the engine says about this pin. Drops at compact width;
          the validation panel carries the same text at every width, and the row keeps
          its own error flag so the panel's anchor still lands somewhere visible. */}
      <td className="qcms-cell--drop" data-owner="library">
        {row.issues.length === 0 ? (
          <span className="qcms-pinissues__none">{t("forms.step.noIssues")}</span>
        ) : (
          <ul className="qcms-pinissues">
            {row.issues.map((issue, index) => (
              <li key={`${issue.code}:${String(index)}`} data-issue-code={issue.code}>
                {messageForIssue(issue)}
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

/**
 * The copy control contract §2 requires of an identifying column.
 *
 * Its accessible name carries the entity and the value ("Copy question id
 * q_at_fault_accident") rather than a bare "Copy" repeated down the column, which is
 * the clause's own wording: a screen-reader user reading the column's controls in
 * sequence otherwise hears the same word five times.
 *
 * It is JS-only, and §2 accepts that **because** the full id is reachable without JS:
 * it is rendered whole in the cell right beside this button, and the question's own
 * detail route is headed with it. Nothing here is the sole route to the value.
 */
function CopyQuestionId({ questionId }: { readonly questionId: string }) {
  return (
    <button
      type="button"
      className="qcms-copyid"
      data-readonly-action="copy"
      aria-label={t("forms.step.copyQuestionId", { questionId })}
      onClick={() => {
        // The `?.` guards the whole chain, not just the property after it: optional
        // chaining short-circuits every call and member access to its right, so with no
        // `navigator.clipboard` (an insecure context, or an older engine) this expression
        // is `undefined` and `.then` is never evaluated. `void undefined` is fine.
        void navigator.clipboard?.writeText(questionId).then(
          () => {
            announce(t("forms.step.copiedQuestionId", { questionId }));
          },
          () => {
            // A refused clipboard is not worth an error state: the id is already on
            // screen in full, so the operator can still select it by hand.
          },
        );
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V5a2 2 0 0 1 2-2h10" />
      </svg>
    </button>
  );
}
