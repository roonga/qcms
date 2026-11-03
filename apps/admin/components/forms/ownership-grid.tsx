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
  readonly draft: DraftForm;
  readonly onPinAction: (row: PinRowView, action: PinRowAction) => void;
  readonly onMovePin: (questionId: string, version: number) => void;
  /* The host owns the add control and must move focus there when removal leaves no neighboring grip. */
  readonly onFocusAdd: () => void;
  readonly groupActions?: {
    readonly onOpen: (groupId: string) => void;
    readonly onMove: (groupId: string, delta: -1 | 1) => void;
    readonly onRemove: (groupId: string) => void;
  };
}) {
  const [menuAt, setMenuAt] = useState<string | undefined>(undefined);
  const [focusWant, setFocusWant] = useState<FocusWant | undefined>(undefined);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

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
      <td colSpan={5} data-owner="form">
        <div className="qcms-grouprow__bar">
          {/* Group-level refusals need a focusable boundary even when no individual question is at fault. */}
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

function groupDisabledCommands(row: GroupBoundaryView): string[] {
  const disabled: string[] = [];
  if (row.position <= 1) disabled.push("up");
  if (row.position >= row.total) disabled.push("down");
  return disabled;
}

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
  const versionLabel = t("forms.step.pinVersion", { version: row.version });

  return (
    <tr
      className={(row.issues?.length ?? 0) > 0 ? "qcms-pinrow is-error" : "qcms-pinrow"}
      data-pin-index={row.position - 1}
      data-pin-question={row.questionId}
      data-pin-version={row.version}
      {...(row.groupId === undefined ? {} : { "data-pin-group": row.groupId })}
    >
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

      <th scope="row" className="qcms-pincell--question" data-owner="library">
        <span
          id={pinAnchorId(row.questionId)}
          tabIndex={-1}
          className="qcms-pinrow__label"
          data-fallback={row.labelFallback}
        >
          {row.label}
        </span>
        <EntityId kind="question" value={row.questionId} copy className="qcms-pinrow__id" />
      </th>

      <td className="qcms-cell--drop" data-owner="library">
        {row.type}
      </td>

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

      <td className="qcms-cell--drop" data-owner="library">
        {row.issues === undefined || row.issues.length === 0 ? (
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

/* An unread library is unknown, not an empty set proving a pinned version is missing. */
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
