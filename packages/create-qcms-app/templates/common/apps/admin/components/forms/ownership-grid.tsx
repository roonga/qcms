"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { EntityId } from "@/components/entity-id";
import { Menu, type MenuItemEntry } from "@/components/kit";
import { menuClasses } from "@/components/menu-slots";
import { RowMenu } from "@/components/row-menu";
import { announce } from "@/lib/announce";
import { groupAnchorId, messageForIssue, pinAnchorId } from "@/lib/forms/issues";
import {
  pinRowMenuItems,
  pinStateLabel,
  type GroupBoundaryView,
  type PinRowAction,
  type PinRowView,
  type StepGridRow,
} from "@/lib/forms/pin-grid";
import type { DraftForm } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

/**
 * The pin list's OWNERSHIP GRID, shared by the step editor and the repeating group's panel
 * (issue 517; extracted and widened for groups in task 074, ADR-42).
 *
 * ## Why it is one component rather than two tables
 *
 * ADR-42's whole argument is that a question does not know it is repeated: a group's member
 * pin resolves, compiles, validates and serves exactly like a step's own. If the group panel
 * drew its member list with its own table, the first thing an author would learn from the
 * screen is the opposite - that a repeated question is a different kind of thing - and the
 * second would be whichever of the two grids had drifted. So there is one grid, it renders a
 * list of {@link StepGridRow}, and the two hosts differ only in which rows they hand it: the
 * step editor hands it the step's items with each group expanded behind a boundary row, and
 * the panel hands it one group's members.
 *
 * ## The ownership split, unchanged
 *
 * This is the app's one genuinely **mixed** table (`plan/admin-ux-audit.md` §8 item 5). A
 * pin's position in its container and the version it points at belong to the FORM and are
 * editable here; `questionId`, `label` and `type` belong to the question LIBRARY and cannot
 * be changed from a form at all. Every cell repeats the split as `data-owner`, which is what
 * `pin-grid-ownership.test.tsx` asserts - the contrast is the point of the design, so it is
 * pinned structurally rather than left to a screenshot.
 *
 * ## Positions are counted against the CONTAINER
 *
 * `lib/forms/pin-grid.ts` scopes `position` and `total` to the pin's own container, so a
 * member of a six-question group reads "3 of 6" and Move up at its first position is
 * disabled. Nothing here can move a pin into or out of a group: that would be a change to
 * whether a question is repeated, and the only gestures for it are the library picker and
 * Remove.
 *
 * ## Reorder, and what it is not
 *
 * The grip is the row's one control: Arrow Up and Arrow Down reorder while it holds focus,
 * Enter, Space or a click opens the row menu. **There is no drag**, deliberately - it would
 * engage WCAG 2.2 SC 2.5.7 and need a single-pointer alternative, and the menu's Move up and
 * Move down already are that path (`plan/admin-mobile-stance.md`).
 */
/**
 * Where focus is owed after an action, as a tagged pair rather than a string with one magic
 * value in it: a question id and "the add control" are different things, and a union of
 * `string | "add"` collapses to `string` the moment anything reads it.
 */
type FocusWant = { readonly kind: "add" } | { readonly kind: "pin"; readonly questionId: string };

export function OwnershipGrid({
  caption,
  rows,
  draft,
  onPinAction,
  onMovePin,
  onFocusAdd,
  groupActions,
}: {
  readonly caption: string;
  readonly rows: readonly StepGridRow[];
  /**
   * The draft, for the two publish refusals whose sentence is composed from it
   * (`messageForIssue`): the budget refusal names both groups' declared maxima, which live in
   * the draft rather than on the issue.
   */
  readonly draft: DraftForm;
  readonly onPinAction: (row: PinRowView, action: PinRowAction) => void;
  readonly onMovePin: (questionId: string, version: number) => void;
  /**
   * Where focus goes when the last row of a container is removed. The host owns the add
   * control, so it owns that move; without it a keyboard operator is stranded on `<body>`,
   * which is the defect task 032 recorded for the option list.
   */
  readonly onFocusAdd: () => void;
  /**
   * What a group boundary row can do, when the host has group rows at all. Absent on the
   * group panel, whose rows are one group's members and carry no boundary.
   */
  readonly groupActions?: {
    readonly onOpen: (groupId: string) => void;
    readonly onMove: (groupId: string, delta: -1 | 1) => void;
    readonly onRemove: (groupId: string) => void;
  };
}) {
  const [menuAt, setMenuAt] = useState<string | undefined>(undefined);
  /** A grip to focus once the row it names exists, or the host's own add control. */
  const [focusWant, setFocusWant] = useState<FocusWant | undefined>(undefined);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

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
   * `<body>`, stranding a keyboard operator at the top of the document with no announcement.
   * A neighbouring grip is the destination, or the host's add control when the container has
   * just emptied and there is no neighbour.
   *
   * The want is a QUESTION ID rather than an index since task 074, and that is the fix the
   * group split forces: an index was a position in one flat list, and a grid holding a step's
   * pins plus two groups' members has three numbering schemes in it, so "index 2" named a
   * different row depending on which container the removed row had been in.
   */
  useEffect(() => {
    if (focusWant === undefined) return;
    if (focusWant.kind === "add") {
      onFocusAdd();
      setFocusWant(undefined);
      return;
    }
    bodyRef.current
      ?.querySelector<HTMLElement>(
        `[data-pin-question="${CSS.escape(focusWant.questionId)}"] [data-pin-grip]`,
      )
      ?.focus();
    setFocusWant(undefined);
  }, [focusWant, onFocusAdd]);

  /** The pin rows alone, so a neighbour can be found within the removed row's container. */
  const pins = rows.flatMap((row) => (row.kind === "pin" ? [row.pin] : []));

  function neighbourOf(row: PinRowView): FocusWant {
    const siblings = pins.filter((candidate) => candidate.groupId === row.groupId);
    const at = siblings.findIndex((candidate) => candidate.questionId === row.questionId);
    const neighbour = siblings[at - 1] ?? siblings[at + 1];
    return neighbour === undefined
      ? { kind: "add" }
      : { kind: "pin", questionId: neighbour.questionId };
  }

  function moveBy(row: PinRowView, delta: -1 | 1): void {
    const to = row.position + delta;
    if (to < 1 || to > row.total) return;
    onPinAction(row, delta === -1 ? "moveUp" : "moveDown");
    announce(
      t("forms.step.pinMoved", { questionId: row.questionId, position: to, total: row.total }),
    );
  }

  function runPinAction(row: PinRowView, action: PinRowAction): void {
    setMenuAt(undefined);
    if (action === "remove") {
      setFocusWant(neighbourOf(row));
      onPinAction(row, action);
      announce(t("forms.step.pinRemoved", { questionId: row.questionId }));
      return;
    }
    if (action === "moveUp" || action === "moveDown") {
      setFocusWant({ kind: "pin", questionId: row.questionId });
      moveBy(row, action === "moveUp" ? -1 : 1);
      return;
    }
    onPinAction(row, action);
  }

  function onGripKeyDown(row: PinRowView, event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      setFocusWant({ kind: "pin", questionId: row.questionId });
      moveBy(row, event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      // Handled here rather than in a click handler so the button's own Enter/Space
      // activation cannot also fire and toggle the menu straight back shut.
      event.preventDefault();
      setMenuAt((open) => (open === row.questionId ? undefined : row.questionId));
    }
  }

  return (
    <div className="qcms-table qcms-table--pins">
      <table>
        <caption className="qcms-visually-hidden">{caption}</caption>
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
          {rows.map((row) =>
            row.kind === "group" ? (
              <GroupBoundaryRow
                key={`group:${row.group.groupId}`}
                row={row.group}
                draft={draft}
                actions={groupActions}
              />
            ) : (
              <PinRow
                key={row.pin.questionId}
                row={row.pin}
                draft={draft}
                isMenuOpen={menuAt === row.pin.questionId}
                onGripKeyDown={(event) => {
                  onGripKeyDown(row.pin, event);
                }}
                onGripClick={() => {
                  setMenuAt((open) =>
                    open === row.pin.questionId ? undefined : row.pin.questionId,
                  );
                }}
                onAction={(action) => {
                  runPinAction(row.pin, action);
                }}
                onMenuClose={() => {
                  setMenuAt(undefined);
                  setFocusWant({ kind: "pin", questionId: row.pin.questionId });
                }}
                onMovePin={onMovePin}
              />
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A repeating group's boundary, as one row that spans the grid (ADR-42, task 074).
 *
 * ## Why the span is stated rather than drawn
 *
 * A group inside a step's question list is a contiguous run of pins, and what an author
 * scanning the step needs to know about it is not where it ends in pixels but what decides
 * its size: a fixed count, an earlier answer, or the respondent. So the row carries the name,
 * the member count and the count source in words, plus the presentation, and the member rows
 * follow it indented by `data-pin-group`.
 *
 * **It says out loud when the group cannot be published.** `max` is required on both bounded
 * count sources (Q4 as amended by Q14), and the grid is where a step is scanned - so a group
 * with the field still empty says so here, derived from the draft rather than from a verdict,
 * which means it is honest before any round trip has happened.
 *
 * The row is LIBRARY-OWNED nowhere: every fact on it belongs to the form, which is why the
 * cell carries `data-owner="form"` and holds controls. There is nothing on a group that the
 * question library has an opinion about.
 */
function GroupBoundaryRow({
  row,
  draft,
  actions,
}: {
  readonly row: GroupBoundaryView;
  readonly draft: DraftForm;
  readonly actions?:
    | {
        readonly onOpen: (groupId: string) => void;
        readonly onMove: (groupId: string, delta: -1 | 1) => void;
        readonly onRemove: (groupId: string) => void;
      }
    | undefined;
}) {
  return (
    <tr className="qcms-grouprow" data-pin-group-boundary={row.groupId}>
      {/* `colSpan` over the whole grid: a boundary is not a row of the same columns, it is a
          statement about the rows under it, and spreading its three facts across cells headed
          Question, Type, Version and Issues would label each of them as something it is not. */}
      <td colSpan={5} data-owner="form">
        <div className="qcms-grouprow__bar">
          {/* The focus destination for every group-scoped publish refusal
              (`anchorFor`): a refusal about the bounds or the instance heading names no
              question, so without this it would render in the validation panel with nothing
              to move focus to. */}
          <span
            id={groupAnchorId(row.groupId)}
            tabIndex={-1}
            className="qcms-grouprow__label"
            data-group-presentation={row.presentation}
          >
            {t("forms.group.boundary", { label: row.label })}
          </span>
          <EntityId kind="group" value={row.groupId} copy className="qcms-grouprow__id" />
          <span className="qcms-grouprow__summary">
            {t("forms.group.boundarySummary", {
              members: row.memberSummary,
              count: row.countSummary,
            })}
          </span>
          <span className="qcms-tag qcms-tag--draft">{row.presentationLabel}</span>
          {row.maxMissing && (
            <span className="qcms-tag qcms-tag--deprecated" data-group-max-missing="">
              {t("forms.group.maxMissing")}
            </span>
          )}
          {actions !== undefined && (
            <Menu
              triggerLabel={t("forms.group.menu", { label: row.label })}
              trigger={<span aria-hidden="true">{"⋮"}</span>}
              menuLabel={t("forms.group.menu", { label: row.label })}
              classNames={menuClasses("qcms-grouprow__menu")}
              disabledKeys={groupDisabledCommands(row)}
              onAction={(key) => {
                if (key === "open") actions.onOpen(row.groupId);
                else if (key === "up") actions.onMove(row.groupId, -1);
                else if (key === "down") actions.onMove(row.groupId, 1);
                else if (key === "remove") actions.onRemove(row.groupId);
              }}
              items={[
                { id: "open", label: t("forms.group.open") },
                { id: "up", label: t("forms.group.moveUp") },
                { id: "down", label: t("forms.group.moveDown") },
                { id: "remove", label: t("forms.group.remove") },
              ]}
            />
          )}
        </div>
        {row.issues !== undefined && row.issues.length > 0 && (
          <ul className="qcms-pinissues" aria-label={t("forms.group.issues")}>
            {row.issues.map((issue, index) => (
              <li key={`${issue.code}:${String(index)}`} data-issue-code={issue.code}>
                {messageForIssue(issue, draft)}
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

/** Greyed rather than silently inert, the same rule the step row's menu applies. */
function groupDisabledCommands(row: GroupBoundaryView): string[] {
  const disabled: string[] = [];
  if (row.position <= 1) disabled.push("up");
  if (row.position >= row.total) disabled.push("down");
  return disabled;
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
  draft,
  isMenuOpen,
  onGripKeyDown,
  onGripClick,
  onAction,
  onMenuClose,
  onMovePin,
}: {
  readonly row: PinRowView;
  readonly draft: DraftForm;
  readonly isMenuOpen: boolean;
  readonly onGripKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  readonly onGripClick: () => void;
  readonly onAction: (action: PinRowAction) => void;
  readonly onMenuClose: () => void;
  readonly onMovePin: (questionId: string, version: number) => void;
}) {
  const stateLabel = pinStateLabel(row.versionStatus);
  /** What the version control shows, and therefore the front of what it is called. */
  const versionLabel = t("forms.step.pinVersion", { version: row.version });

  return (
    <tr
      className={(row.issues?.length ?? 0) > 0 ? "qcms-pinrow is-error" : "qcms-pinrow"}
      data-pin-index={row.position - 1}
      data-pin-question={row.questionId}
      data-pin-version={row.version}
      {...(row.groupId === undefined ? {} : { "data-pin-group": row.groupId })}
    >
      {/* FORM-OWNED: the row's position in its container, changed from the grip. */}
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
        {/* The id and its copy control, both through the one component every admin table
            renders an identifying id with (issue #582). A question id is DERIVED from the
            author's own text, so §2's 2026-08-21 amendment renders it whole. */}
        <EntityId kind="question" value={row.questionId} copy className="qcms-pinrow__id" />
      </th>

      {/* LIBRARY-OWNED, and one of the two columns that drop at compact width. */}
      <td className="qcms-cell--drop" data-owner="library">
        {row.type}
      </td>

      {/* FORM-OWNED: the one version change the builder has (R7).

          The trigger's name STARTS with the text it paints (WCAG 2.5.3, issue #879).
          `kit.Menu` turns `triggerLabel` into an `aria-label` whenever it is given
          alongside a `trigger`, and an `aria-label` REPLACES the content it sits on in the
          name computation - so a bare "Move pin for q_x" left this control showing `v3`
          and answering to nothing a person could see. `versionLabel` is the one string
          both halves are built from. */}
      <td className="qcms-pincell--version qcms-cell--num" data-owner="form">
        <Menu
          triggerLabel={t("forms.step.movePin", { versionLabel, questionId: row.questionId })}
          trigger={
            <>
              {versionLabel}
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
            </>
          }
          menuLabel={t("forms.step.movePin", { versionLabel, questionId: row.questionId })}
          classNames={menuClasses("qcms-pinversion")}
          onAction={(key) => {
            const version = Number.parseInt(String(key), 10);
            if (Number.isInteger(version)) onMovePin(row.questionId, version);
          }}
          items={versionMenuItems(row.otherVersions)}
        />
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
        {row.issues === undefined || row.issues.length === 0 ? (
          // Three states, two of which look identical if you only count: no verdict yet,
          // a verdict of none, and a verdict with something in it. The `data-pin-issues`
          // attribute is how a test tells the first two apart without matching on copy.
          <span
            className="qcms-pinissues__none"
            data-pin-issues={row.issues === undefined ? "unchecked" : "none"}
          >
            {t(row.issues === undefined ? "forms.step.issuesUnchecked" : "forms.step.noIssues")}
          </span>
        ) : (
          <ul className="qcms-pinissues">
            {row.issues.map((issue, index) => (
              <li key={`${issue.code}:${String(index)}`} data-issue-code={issue.code}>
                {messageForIssue(issue, draft)}
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

/**
 * What the version menu offers, which is three answers rather than two (issue 572).
 *
 * "No other published version" is a statement about the LIBRARY, so it is only sayable
 * when the library was read. `undefined` is the read that never happened, and it says so
 * instead of reporting an absence that its own missing data produced - which is what
 * every failed library read used to do, on every pin in the form.
 */
function versionMenuItems(otherVersions: readonly number[] | undefined): MenuItemEntry[] {
  if (otherVersions === undefined) {
    return [{ id: "unknown", label: t("forms.step.movePinUnknown"), isDisabled: true }];
  }
  if (otherVersions.length === 0) {
    return [{ id: "none", label: t("forms.step.movePinNone"), isDisabled: true }];
  }
  return otherVersions.map((version) => ({
    id: String(version),
    label: t("forms.step.movePinTo", { version }),
  }));
}
