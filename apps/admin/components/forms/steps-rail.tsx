"use client";

import { useState } from "react";

import {
  Button,
  Dialog,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MenuTriggerButton,
  TextField,
} from "@/components/kit";
import { stepAnchorId } from "@/lib/forms/issues";
import type { DraftForm, DraftStep } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { textOf } from "@/lib/questions/definition";

/**
 * The ordered step rail (task 033; wireframe "steps rail").
 *
 * ## Reorder is a menu command, never a drag
 *
 * The wireframe's a11y note asks for this outright, and it is the same call 032's option
 * list made for the same reason: a drag-only reorder is unusable by keyboard and by anyone
 * with a motor impairment. Move up and move down are ordinary menu items, so the whole
 * rail is operable with Tab, Enter and the arrow keys, and there is no second
 * "accessible alternative" path to keep in sync with a primary one.
 *
 * Reordering steps changes **document order**, which is exactly what ADR-16 reads, so a
 * move that was fine a moment ago can make a rule's target backward. That is not guarded
 * against here: the move is allowed, the debounced validation reports it against the rule,
 * and the author decides. Refusing the move would be the builder overruling an author on a
 * judgement the engine is the authority for (R2).
 *
 * ## Rename is inline, remove is confirmed
 *
 * A rename is cheap and reversible, so it happens in place. Removing a step takes its pins
 * with it and leaves any rule that named it dangling, so it asks first - and the
 * confirmation states the consequence rather than asking "are you sure?", which is 032's
 * convention and ADR-02's reason for it.
 *
 * A step's `stepId` is minted once and never changes, through every rename and every move
 * (`draft.ts`). That is what lets a rule target a step at all, and it is why nothing here
 * touches the id.
 */
export function StepsRail({
  draft,
  issueCounts,
  selectedStepId,
  onSelect,
  onAdd,
  onRename,
  onMove,
  onRemove,
}: {
  readonly draft: DraftForm;
  readonly issueCounts: ReadonlyMap<string, number>;
  readonly selectedStepId: string | undefined;
  readonly onSelect: (stepId: string) => void;
  readonly onAdd: (title: string) => void;
  readonly onRename: (stepId: string, title: string) => void;
  readonly onMove: (stepId: string, delta: -1 | 1) => void;
  readonly onRemove: (stepId: string) => void;
}) {
  const [newTitle, setNewTitle] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const removing = draft.steps.find((step) => step.stepId === removingId);

  return (
    <nav
      aria-label={t("forms.steps.title")}
      className="flex flex-col gap-3 rounded-md border border-(--color-border) bg-(--color-surface) p-4"
    >
      <h2 className="text-base font-semibold text-(--color-text)">{t("forms.steps.title")}</h2>

      {draft.steps.length === 0 && (
        <p className="text-sm text-(--color-text-muted)">{t("forms.steps.empty")}</p>
      )}

      <ol className="flex flex-col gap-1">
        {draft.steps.map((step, index) => (
          <li key={step.stepId}>
            <StepRow
              step={step}
              position={index + 1}
              total={draft.steps.length}
              issueCount={issueCounts.get(step.stepId) ?? 0}
              isSelected={step.stepId === selectedStepId}
              isRenaming={step.stepId === renamingId}
              onSelect={() => {
                onSelect(step.stepId);
              }}
              onRename={(title) => {
                onRename(step.stepId, title);
              }}
              onStartRename={() => {
                setRenamingId(step.stepId);
              }}
              onEndRename={() => {
                setRenamingId(null);
              }}
              onMove={(delta) => {
                onMove(step.stepId, delta);
              }}
              onAskRemove={() => {
                setRemovingId(step.stepId);
              }}
            />
          </li>
        ))}
      </ol>

      <div className="flex items-end gap-2">
        <TextField label={t("forms.steps.newTitle")} value={newTitle} onChange={setNewTitle} />
        <Button
          variant="secondary"
          size="md"
          isDisabled={newTitle.trim() === ""}
          onPress={() => {
            onAdd(newTitle.trim());
            setNewTitle("");
          }}
        >
          {t("forms.steps.add")}
        </Button>
      </div>

      {removing !== undefined && (
        <Dialog
          isOpen
          role="alertdialog"
          title={t("forms.steps.confirmRemoveTitle", { title: titleOf(removing) })}
          description={t("forms.steps.confirmRemoveBody")}
          onOpenChange={(isOpen) => {
            if (!isOpen) setRemovingId(null);
          }}
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              size="md"
              onPress={() => {
                onRemove(removing.stepId);
                setRemovingId(null);
              }}
            >
              {t("forms.steps.confirmRemove")}
            </Button>
            <Button
              variant="ghost"
              size="md"
              onPress={() => {
                setRemovingId(null);
              }}
            >
              {t("forms.action.cancel")}
            </Button>
          </div>
        </Dialog>
      )}
    </nav>
  );
}

/** A step's display name, which is its title or a stand-in while it has none. */
function titleOf(step: DraftStep): string {
  const text = textOf(step.title);
  return text === "" ? t("forms.steps.untitled") : text;
}

interface StepRowProps {
  readonly step: DraftStep;
  readonly position: number;
  readonly total: number;
  readonly issueCount: number;
  readonly isSelected: boolean;
  readonly isRenaming: boolean;
  readonly onSelect: () => void;
  readonly onRename: (title: string) => void;
  readonly onStartRename: () => void;
  readonly onEndRename: () => void;
  readonly onMove: (delta: -1 | 1) => void;
  readonly onAskRemove: () => void;
}

function StepRow(props: StepRowProps) {
  const { step, position, total, issueCount, isSelected, isRenaming } = props;
  const title = titleOf(step);

  return (
    <div className="flex items-center gap-2">
      {isRenaming ? (
        <div className="flex flex-1 items-end gap-2">
          <TextField
            label={t("forms.steps.renameLabel", { title })}
            value={textOf(step.title)}
            autoFocus
            onChange={props.onRename}
          />
          <Button variant="secondary" size="sm" onPress={props.onEndRename}>
            {t("forms.steps.renameDone")}
          </Button>
        </div>
      ) : (
        <>
          <Button variant="ghost" size="sm" onPress={props.onSelect}>
            <span className="qcms-visually-hidden">{t("forms.steps.select", { title })}</span>
            <span aria-hidden="true">{`${String(position)}. ${title}`}</span>
          </Button>
          {issueCount > 0 && (
            <span
              className="qcms-tag qcms-tag--draft"
              data-step-issues={String(issueCount)}
              data-step={step.stepId}
            >
              {issueCount === 1
                ? t("forms.steps.issuesOne")
                : t("forms.steps.issues", { count: issueCount })}
            </span>
          )}
          {isSelected && (
            // The rail's own selection is visual; the step editor is what is actually
            // "current", so the marker is announced there rather than duplicated here.
            <span aria-hidden="true" className="text-(--color-primary)">
              {"●"}
            </span>
          )}
        </>
      )}

      <MenuTrigger>
        <MenuTriggerButton
          aria-label={t("forms.steps.menu", { title })}
          className="rounded-md border border-(--color-border) px-2 py-1 text-sm text-(--color-text) hover:bg-(--color-surface-hover)"
        >
          <span aria-hidden="true">{"⋯"}</span>
        </MenuTriggerButton>
        <MenuPopover className="qcms-menu">
          <MenuList
            className="qcms-menu__list"
            aria-label={t("forms.steps.menu", { title })}
            disabledKeys={disabledCommands(position, total)}
            onAction={(key) => {
              runCommand(String(key), props);
            }}
          >
            <MenuItem id="rename" className="qcms-menu__item">
              {t("forms.steps.rename")}
            </MenuItem>
            <MenuItem id="up" className="qcms-menu__item">
              {t("forms.steps.moveUp")}
            </MenuItem>
            <MenuItem id="down" className="qcms-menu__item">
              {t("forms.steps.moveDown")}
            </MenuItem>
            <MenuItem id="remove" className="qcms-menu__item">
              {t("forms.steps.remove")}
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </MenuTrigger>

      {/* The focus destination for a step-addressed issue. Off-screen and unfocusable by
          Tab, reachable only when the validation panel sends focus here. */}
      <span id={stepAnchorId(step.stepId)} tabIndex={-1} className="qcms-visually-hidden">
        {title}
      </span>
    </div>
  );
}

/** The commands that do not apply at this position, so the menu greys them out. */
function disabledCommands(position: number, total: number): string[] {
  const disabled: string[] = [];
  if (position === 1) disabled.push("up");
  if (position === total) disabled.push("down");
  return disabled;
}

/** Route one menu command, kept out of the row so neither carries the other's branches. */
function runCommand(key: string, props: StepRowProps): void {
  if (key === "rename") props.onStartRename();
  if (key === "up") props.onMove(-1);
  if (key === "down") props.onMove(1);
  if (key === "remove") props.onAskRemove();
}
