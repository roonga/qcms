"use client";

import { useRef, useState, type ReactNode } from "react";

import { EmptyState } from "@/components/empty-state";
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

/**
 * One step's pinned questions, as the ownership grid (task 033; issue 517; groups in 074).
 *
 * ## Why this table is the one worth rebuilding
 *
 * `plan/admin-ux-audit.md` §8 item 5 calls this the highest-value design change in the
 * admin redesign, and the reason is ownership. The grid itself now lives in
 * `components/forms/ownership-grid.tsx`, because the repeating group's panel draws the same
 * one over its member list - which is ADR-42's own argument made visible: a question does not
 * know it is repeated, so a member pin is drawn by the same grid, with the same ownership
 * split, as a step's own. That module carries the ownership reasoning; what is left here is
 * the step's own chrome and the two things an author can ADD to a step.
 *
 * ## A step holds two kinds of thing now
 *
 * `Step.items` was an array of pins and is a union with the repeating group (ADR-42). So this
 * screen has two add controls rather than one, and the grid shows a group as a BOUNDARY row
 * followed by its members: see `lib/forms/pin-grid.ts` for why a boundary is a row rather than
 * a nested table.
 *
 * **Group SETTINGS are not here.** They are a panel of their own, reached from the boundary
 * row's menu or from the group's row in the rail, because six fields about a group would
 * otherwise sit under a question list they are not about - the same reasoning that moved the
 * form's own five panels off the step screen in 2026-08-26.
 *
 * ## Every row still says `questionId` and its version, out loud
 *
 * That pair is the product's governance model, and it is why a row shows the id in monospace
 * rather than a friendly label with the version in a tooltip. An author looking at this list
 * can see, without opening anything, exactly which frozen definition each question in this
 * form will serve (R6). The grid's own module records the §2 deviation this column takes.
 *
 * ## A library that did not load says nothing about the pins (issues 572, 544)
 *
 * `library` is a `ReadState` (`lib/read-state.ts`), not an array, and it is passed straight
 * through to `stepGridRows` and to the picker rather than unwrapped here. Every library-owned
 * cell of the grid is a lookup, and an empty library is not a neutral input to one: handed
 * `ok ? data : []`, a failed read claimed on every row that the library had no label, no type,
 * no such version and nowhere else to move to.
 *
 * Nothing form-owned changes. The pins are still listed, and the grip menu, the version menu,
 * the keyboard reorder and both add controls all still work: they edit the DRAFT, which was
 * read successfully.
 */
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
  /**
   * A brief "Saved", shown beside this step's heading when an autosave lands.
   *
   * Passed in rather than rendered here because the save state belongs to the builder,
   * which owns the draft and its autosave; this component only knows where it goes.
   */
  readonly saveFlash?: ReactNode;
  readonly step: DraftStep;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  /**
   * The engine's verdict, or `undefined` when no check has landed yet (issue 625). The
   * Issues column says `None` about the first and says so about the second, rather than
   * printing an all-clear per pin about a draft nothing has validated.
   */
  readonly issues: readonly FormIssue[] | undefined;
  /**
   * Every pin the picker chose, in one call, at one insert boundary inside one container.
   *
   * `groupId` is the container: `undefined` pins into the step itself and a group id pins
   * into that group. `index` is an insert boundary within that container - 0 before its first
   * pin, its length appends - and the pins land in list order from there. A list rather than
   * a call per pin because the builder folds them into one draft update (issue 660): a handler
   * called N times computes N times from the same closed-over draft and keeps only the last.
   */
  readonly onAddPins: (
    pins: readonly DraftPin[],
    index: number,
    groupId: string | undefined,
  ) => void;
  readonly onMovePin: (questionId: string, version: number) => void;
  readonly onRemovePin: (questionId: string) => void;
  /** Reorder one pin inside its own container, which `groupId` names. */
  readonly onReorderPin: (
    questionId: string,
    delta: -1 | 1,
    groupId: string | undefined,
  ) => void;
  readonly onAddGroup: (label: string) => void;
  readonly onOpenGroup: (groupId: string) => void;
  readonly onMoveGroup: (groupId: string, delta: -1 | 1) => void;
  readonly onRemoveGroup: (groupId: string) => void;
}) {
  /** The insert boundary and container the open picker would pin into, or nothing. */
  const [pickerAt, setPickerAt] = useState<
    { readonly index: number; readonly groupId: string | undefined } | undefined
  >(undefined);
  const [addingGroup, setAddingGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  /** The group a confirm is open for, which removal always goes through. */
  const [removingGroup, setRemovingGroup] = useState<string | undefined>(undefined);

  const addRef = useRef<HTMLDivElement>(null);

  const title = textOf(step.title) === "" ? t("forms.steps.untitled") : textOf(step.title);
  const rows = stepGridRows(step, library, issues);
  const hasRows = rows.length > 0;
  const removingLabel = rows.find(
    (row) => row.kind === "group" && row.group.groupId === removingGroup,
  );

  /** The insert boundary one row's menu asks for, counted inside that row's own container. */
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
      {/* AN `h1`, because on the step screen this IS the screen's subject (Code Owner,
          2026-08-26). The form's name used to be the `<h1>` above both of the builder's
          screens; it moved to the form's own screen with the rest of the form's identity,
          which would have left a step screen whose highest heading was an `h2` - a
          `heading-order` violation and a page with no level-one heading, both of which
          `e2e/a11y-axe.pw.ts` sweeps for. */}
      {/* The heading and the save flash share one row, whose height the heading sets. A
          transient element in the column's own flow would push the screen down as it
          arrived and pull it back as it left: a layout shift twice per autosave. */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 id="qcms-step-heading" className="text-base font-semibold text-(--color-text)">
          {t("forms.step.heading", { title })}
        </h1>
        {saveFlash}
      </div>
      <p className="text-sm text-(--color-text-muted)">{t("forms.step.pinNote")}</p>

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
        // `plan/admin-design-contracts.md` §3, and its 2026-08-20 amendment: the panel
        // carries no CTA here, because the creating action is the library button two
        // elements below it rather than a route this panel would have to point at.
        <EmptyState
          heading={t("forms.step.empty")}
          body={t("forms.step.emptyBody")}
          testId="qcms-step-empty"
        />
      )}

      {/* TWO ADD CONTROLS, in the order a step is built: a question is the ordinary thing to
          add and a group is the structural one, so the question control keeps its place and
          the group control sits beside it rather than above. Both append to the step, which
          is what makes the control beside the end of the list the one that matches what
          pressing it does (the same argument the rail's Add step makes). */}
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

      {/* NAMING A GROUP IS A DIALOG, the same shape Add step uses (`rail-steps.tsx`), for the
          same reason the step's own dialog gives: a field standing open under a list is a
          permanent empty input on a screen nobody is adding anything on. The name is required
          because it is what the group id is minted from and what the instance heading starts
          as - an unnamed group would mint `grp_group` and leave an empty heading template. */}
      {addingGroup && (
        <Dialog
          isOpen
          title={t("forms.group.add")}
          onOpenChange={(isOpen: boolean) => {
            if (!isOpen) setAddingGroup(false);
          }}
        >
          <TextField
            label={t("forms.group.newName")}
            description={t("forms.group.nameHint")}
            value={groupName}
            onChange={setGroupName}
          />
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

      {/* Removing a group takes the questions pinned inside it with it and leaves any rule
          that read it dangling, so it asks first - the same confirm, for the same reason, that
          removing a step has had since task 033. */}
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
