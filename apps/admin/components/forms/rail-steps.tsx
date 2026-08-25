"use client";

import Link from "next/link";
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
import { useBuilderRail } from "@/lib/forms/builder-bridge";
import { issueCountLabel, type RailItem } from "@/lib/forms/subtree-rail";
import { t } from "@/lib/i18n/en";
import { textOf } from "@/lib/questions/definition";

/**
 * The form's steps, inside the rail, on the builder (Code Owner, 2026-08-25).
 *
 * ## Why this is not `steps-rail.tsx` moved
 *
 * The builder used to carry its own step list as a card in the content column, beside a
 * rail that had none: one screen with two step lists and no single place that owned them.
 * That card cannot simply be relocated. It is a panel - a border, a surface, `p-4` - headed
 * by an `<h2>`, and the rail renders BEFORE `<main>` in document order, so a heading here
 * would sit above the screen's own `<h1>` and be a `heading-order` violation on this screen
 * in all three modes. What the rail needs is rail rows, so this is rail rows.
 *
 * `plan/admin-shell-poc/admin-shell-poc.html` is the drawing: a step row carries its
 * ordinal, its title, its issue badge and a menu of Rename / Move up / Move down / Remove
 * step, with an add control under the list. §7's clause forbidding actions in a rail was
 * retired on 2026-08-25 for exactly this; the question detail rail's lifecycle block had
 * already overruled it in practice.
 *
 * ## Two states, and the first one is not a placeholder
 *
 * Before the builder hydrates - and for a reader with no JavaScript at all - this renders
 * the steps the SERVER resolved, as ordinary anchors to `#step-{id}`. That is a real, usable
 * list rather than a skeleton: the slot had already loaded those steps in order to render
 * them, the anchors land on the step they name, and `lib/forms/issues.ts` mints the same
 * fragment the validation panel's focus links use.
 *
 * Once the builder publishes (`lib/forms/builder-bridge.ts`), the rows become buttons that
 * select a step in place and the menus appear. The list does not move or reorder as it
 * upgrades: it is the same steps in the same order, gaining behaviour.
 */
export function RailSteps({ serverItems }: { readonly serverItems: readonly RailItem[] }) {
  const builder = useBuilderRail();
  if (builder === undefined) return <ServerSteps items={serverItems} />;

  return (
    <div className="qcms-rail-steps">
      <ol className="qcms-rail__group" aria-label={t("forms.rail.steps")} data-rail-group="steps">
        {builder.draft.steps.map((step, index) => (
          <li key={step.stepId}>
            <StepRow
              title={textOf(step.title) === "" ? t("forms.steps.untitled") : textOf(step.title)}
              position={index + 1}
              issueCount={builder.issueCounts.get(step.stepId) ?? 0}
              isSelected={step.stepId === builder.selectedStepId}
              onSelect={() => {
                builder.choose(step.stepId);
              }}
              onRename={(title) => {
                builder.rename(step.stepId, title);
              }}
              onMove={(delta) => {
                builder.move(step.stepId, delta);
              }}
              onRemove={() => {
                builder.remove(step.stepId);
              }}
            />
          </li>
        ))}
      </ol>
      <AddStep
        onAdd={(title) => {
          builder.add(title);
        }}
      />
    </div>
  );
}

/**
 * The pre-hydration list, and the whole of it for a scriptless reader.
 *
 * Deliberately the same markup the other seven form screens' steps use, so the rail does
 * not change shape when the builder takes it over.
 */
function ServerSteps({ items }: { readonly items: readonly RailItem[] }) {
  if (items.length === 0) return null;
  return (
    <ol className="qcms-rail__group" aria-label={t("forms.rail.steps")} data-rail-group="steps">
      {items.map((item) => (
        <li key={item.key}>
          <Link
            href={item.href}
            className="qcms-rail__link"
            data-rail-item={item.key}
            {...(item.isCurrent ? { "aria-current": "page" as const } : {})}
          >
            {item.position !== undefined && (
              <span className="qcms-rail__position" aria-hidden="true">
                {t("forms.rail.stepPosition", { position: item.position })}
              </span>
            )}
            <span>{item.label}</span>
            {item.issueCount > 0 && (
              <span className="qcms-tag qcms-tag--draft" data-rail-issues={item.issueCount}>
                {issueCountLabel(item.issueCount)}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ol>
  );
}

/**
 * One interactive step row: a button that selects, and a menu that acts on it.
 *
 * A button rather than an anchor, and that is the rule rather than an exception to it
 * (`docs/admin-constraints.md`: an anchor navigates, a button acts). Selecting a step
 * changes what the editor beside the rail is showing on the screen the reader is already
 * standing on; there is nothing to open in a new tab.
 *
 * REORDER IS A MENU COMMAND, NEVER A DRAG, which is the call the step list has made since
 * task 033 and the reason is unchanged: a drag-only reorder is unusable by keyboard and by
 * anyone with a motor impairment, and a second "accessible alternative" path is a second
 * path to keep in sync. Move up and move down are ordinary menu items.
 */
function StepRow({
  title,
  position,
  issueCount,
  isSelected,
  onSelect,
  onRename,
  onMove,
  onRemove,
}: {
  readonly title: string;
  readonly position: number;
  readonly issueCount: number;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
  readonly onRename: (title: string) => void;
  readonly onMove: (delta: -1 | 1) => void;
  readonly onRemove: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);

  return (
    <div className="qcms-rail-steps__row">
      <button
        type="button"
        className="qcms-rail__link qcms-rail-steps__select"
        data-rail-step-select={title}
        aria-current={isSelected ? "page" : undefined}
        onClick={onSelect}
      >
        {/* The accessible name is the whole sentence, and the visible composite is hidden
            from the tree so it is not read twice. Same shape the retired in-page step list
            used, and deliberately the same STRING: `openStep` and `addStep` in
            `e2e/support/forms.ts` name a step row this way, and so does anyone who has
            learned the screen. Moving the list should not rename its rows. */}
        <span className="qcms-visually-hidden">{t("forms.steps.select", { title })}</span>
        <span className="qcms-rail__position" aria-hidden="true">
          {t("forms.rail.stepPosition", { position })}
        </span>
        <span aria-hidden="true">{title}</span>
        {issueCount > 0 && (
          <span className="qcms-tag qcms-tag--draft" data-rail-issues={issueCount}>
            {issueCountLabel(issueCount)}
          </span>
        )}
      </button>

      <MenuTrigger>
        <MenuTriggerButton
          className="qcms-rail-steps__menu"
          aria-label={t("forms.steps.menu", { title })}
        >
          <span aria-hidden="true">{"⋮"}</span>
        </MenuTriggerButton>
        <MenuPopover className="qcms-menu">
          <MenuList
            className="qcms-menu__list"
            aria-label={t("forms.steps.menu", { title })}
            onAction={(key) => {
              if (key === "rename") {
                setDraftTitle(title);
                setRenaming(true);
              } else if (key === "up") onMove(-1);
              else if (key === "down") onMove(1);
              else if (key === "remove") setRemoving(true);
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

      {/* Rename is a dialog rather than an inline field, because the row is 240px wide and
          an input inside it would be narrower than most step titles. Removing a step takes
          its pins with it and leaves any rule that named it dangling, so it stays behind
          the confirm the step list has always had (`components/forms/steps-rail.tsx`'s
          reasoning, kept when its markup was not). */}
      {renaming && (
        <Dialog
          isOpen
          title={t("forms.steps.rename")}
          onOpenChange={(isOpen: boolean) => {
            if (!isOpen) setRenaming(false);
          }}
        >
          <TextField
            label={t("forms.steps.renameLabel", { title })}
            value={draftTitle}
            onChange={setDraftTitle}
          />
          <Button
            variant="primary"
            size="md"
            onPress={() => {
              onRename(draftTitle);
              setRenaming(false);
            }}
          >
            {t("forms.steps.renameDone")}
          </Button>
        </Dialog>
      )}

      {/* Removing a step takes its pins with it and leaves any rule that named it
          dangling, so it asks first. That confirm is not new here: it is the one the step
          list has had since task 033, kept when its markup was not. */}
      {removing && (
        <Dialog
          isOpen
          role="alertdialog"
          title={t("forms.steps.confirmRemoveTitle", { title })}
          description={t("forms.steps.confirmRemoveBody")}
          onOpenChange={(isOpen: boolean) => {
            if (!isOpen) setRemoving(false);
          }}
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              size="md"
              onPress={() => {
                onRemove();
                setRemoving(false);
              }}
            >
              {t("forms.steps.confirmRemove")}
            </Button>
            <Button
              variant="ghost"
              size="md"
              onPress={() => {
                setRemoving(false);
              }}
            >
              {t("forms.action.cancel")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/** The add control, under the list, where the drawing puts it. */
function AddStep({ onAdd }: { readonly onAdd: (title: string) => void }) {
  const [title, setTitle] = useState("");
  return (
    <div className="qcms-rail-steps__add">
      <TextField label={t("forms.steps.newTitle")} value={title} onChange={setTitle} />
      <Button
        variant="secondary"
        size="sm"
        isDisabled={title.trim() === ""}
        onPress={() => {
          onAdd(title.trim());
          setTitle("");
        }}
      >
        {t("forms.steps.add")}
      </Button>
    </div>
  );
}
