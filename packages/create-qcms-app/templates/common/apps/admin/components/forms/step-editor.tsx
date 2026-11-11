"use client";

import { useRef, useState, type ReactNode } from "react";

import { EmptyState } from "@/components/empty-state";
import { FieldHelp, HelpTip } from "@/components/help-tip";
import { Button, Dialog, TextField } from "@/components/kit";
import { stepGridRows, type PinRowAction, type PinRowView } from "@/lib/forms/pin-grid";
import type {
  DraftForm,
  DraftPin,
  DraftStep,
  PinnableQuestion,
  FormIssue,
} from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { textOf } from "@/lib/questions/definition";
import type { ReadState } from "@/lib/read-state";

import { LibraryPicker } from "./library-picker";
import { OwnershipGrid } from "./ownership-grid";

export function StepEditor({
  draft,
  step,
  library,
  issues,
  onAddPins,
  onMovePin,
  onRemovePin,
  onReorderPin,
  onAddGroup,
  onOpenGroup,
  onMoveGroup,
  onRemoveGroup,
  saveFlash,
}: {
  readonly draft: DraftForm;
  readonly saveFlash?: ReactNode;
  readonly step: DraftStep;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly issues: readonly FormIssue[] | undefined;
  /* Insert selected pins in one draft update; repeated handlers would each close over the same draft and
     retain only the last change. */
  readonly onAddPins: (
    pins: readonly DraftPin[],
    index: number,
    groupId: string | undefined,
  ) => void;
  readonly onMovePin: (questionId: string, version: number) => void;
  readonly onRemovePin: (questionId: string) => void;
  readonly onReorderPin: (questionId: string, delta: -1 | 1, groupId: string | undefined) => void;
  readonly onAddGroup: (label: string) => void;
  readonly onOpenGroup: (groupId: string) => void;
  readonly onMoveGroup: (groupId: string, delta: -1 | 1) => void;
  readonly onRemoveGroup: (groupId: string) => void;
}) {
  const [pickerAt, setPickerAt] = useState<
    { readonly index: number; readonly groupId: string | undefined } | undefined
  >(undefined);
  const [addingGroup, setAddingGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [removingGroup, setRemovingGroup] = useState<string | undefined>(undefined);

  const addRef = useRef<HTMLDivElement>(null);

  const title = textOf(step.title) === "" ? t("forms.steps.untitled") : textOf(step.title);
  const rows = stepGridRows(step, library, issues);
  const hasRows = rows.length > 0;
  const removingLabel = rows.find(
    (row) => row.kind === "group" && row.group.groupId === removingGroup,
  );

  function insertAt(row: PinRowView, action: "insertAbove" | "insertBelow"): void {
    setPickerAt({
      index: action === "insertAbove" ? row.position - 1 : row.position,
      groupId: row.groupId,
    });
  }

  function runPinAction(row: PinRowView, action: PinRowAction): void {
    if (action === "remove") {
      onRemovePin(row.questionId);
      return;
    }
    if (action === "moveUp" || action === "moveDown") {
      onReorderPin(row.questionId, action === "moveUp" ? -1 : 1, row.groupId);
      return;
    }
    insertAt(row, action);
  }

  return (
    <section
      aria-labelledby="qcms-step-heading"
      className="flex flex-col gap-4 rounded-md border border-(--color-border) bg-(--color-surface) p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="qcms-help-head">
          <h1 id="qcms-step-heading" className="text-base font-semibold text-(--color-text)">
            {t("forms.step.heading", { title })}
          </h1>
          <HelpTip>{t("forms.step.pinNote")}</HelpTip>
        </div>
        {saveFlash}
      </div>

      {hasRows ? (
        <OwnershipGrid
          caption={t("forms.step.pins")}
          rows={rows}
          draft={draft}
          onPinAction={runPinAction}
          onMovePin={onMovePin}
          onFocusAdd={() => {
            addRef.current?.querySelector<HTMLElement>("button")?.focus();
          }}
          groupActions={{
            onOpen: onOpenGroup,
            onMove: onMoveGroup,
            onRemove: setRemovingGroup,
          }}
        />
      ) : (
        <EmptyState heading={t("forms.step.empty")} testId="qcms-step-empty" />
      )}

      <div ref={addRef} className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="md"
          onPress={() => {
            setPickerAt({ index: step.items.length, groupId: undefined });
          }}
        >
          {t("forms.step.addQuestion")}
        </Button>
        <Button
          variant="ghost"
          size="md"
          onPress={() => {
            setGroupName("");
            setAddingGroup(true);
          }}
        >
          {t("forms.group.add")}
        </Button>
      </div>

      {pickerAt !== undefined && (
        <LibraryPicker
          isOpen
          stepTitle={title}
          draft={draft}
          library={library}
          onAddPins={(pins) => {
            onAddPins(pins, pickerAt.index, pickerAt.groupId);
          }}
          onClose={() => {
            setPickerAt(undefined);
          }}
        />
      )}

      {/* Require the group name before minting its permanent id and initial heading template. */}
      {addingGroup && (
        <Dialog
          isOpen
          title={t("forms.group.add")}
          onOpenChange={(isOpen: boolean) => {
            if (!isOpen) setAddingGroup(false);
          }}
        >
          <FieldHelp help={t("forms.group.nameHint")}>
            <TextField label={t("forms.group.newName")} value={groupName} onChange={setGroupName} />
          </FieldHelp>
          <Button
            variant="primary"
            size="md"
            isDisabled={groupName.trim() === ""}
            onPress={() => {
              onAddGroup(groupName.trim());
              setAddingGroup(false);
            }}
          >
            {t("forms.group.addDone")}
          </Button>
        </Dialog>
      )}

      {removingGroup !== undefined && (
        <Dialog
          isOpen
          role="alertdialog"
          title={t("forms.group.confirmRemoveTitle", {
            label: removingLabel?.kind === "group" ? removingLabel.group.label : removingGroup,
          })}
          description={t("forms.group.confirmRemoveBody")}
          onOpenChange={(isOpen: boolean) => {
            if (!isOpen) setRemovingGroup(undefined);
          }}
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              size="md"
              onPress={() => {
                onRemoveGroup(removingGroup);
                setRemovingGroup(undefined);
              }}
            >
              {t("forms.group.confirmRemove")}
            </Button>
            <Button
              variant="ghost"
              size="md"
              onPress={() => {
                setRemovingGroup(undefined);
              }}
            >
              {t("forms.action.cancel")}
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
