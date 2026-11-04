"use client";

import Link from "next/link";
import { useState } from "react";

import { Button, Dialog, Menu, TextField } from "@/components/kit";
import { menuClasses } from "@/components/menu-slots";
import { requestAddStep } from "@/lib/forms/add-step-request";
import { useBuilderRail } from "@/lib/forms/builder-bridge";
import { groupAnchorId, stepAnchorId } from "@/lib/forms/issues";
import { isDraftGroup, type DraftGroup, type DraftStep } from "@/lib/forms/types";
import { issueCountLabel, type RailItem } from "@/lib/forms/subtree-rail";
import { t } from "@/lib/i18n/en";
import { textOf } from "@/lib/questions/definition";

export function RailSteps({
  item,
  serverItems,
}: {
  readonly item: RailItem;
  readonly serverItems: readonly RailItem[];
}) {
  const builder = useBuilderRail();
  if (builder === undefined) {
    return (
      <div className="qcms-rail-steps">
        <Link
          href={item.href}
          className="qcms-rail__link"
          data-rail-item={item.key}
          {...(item.isCurrent ? { "aria-current": "page" as const } : {})}
        >
          <span>{item.label}</span>
        </Link>
        <ServerSteps items={serverItems} />
      </div>
    );
  }

  return (
    <div className="qcms-rail-steps">
      <div className="qcms-rail-steps__row">
        <button
          type="button"
          className="qcms-rail__link qcms-rail-steps__form"
          data-rail-item={item.key}
          aria-current={builder.selection.kind === "form" ? "page" : undefined}
          onClick={builder.chooseForm}
        >
          <span>{item.label}</span>
        </button>
        {/* Both controls open one dialog through the shared request store; separate dialogs would hold competing
   title drafts. */}
        <Menu
          triggerLabel={t("forms.rail.formMenu", { title: item.label })}
          trigger={<span aria-hidden="true">{"⋮"}</span>}
          menuLabel={t("forms.rail.formMenu", { title: item.label })}
          classNames={menuClasses("qcms-rail-steps__menu")}
          onAction={(key) => {
            if (key === "add") requestAddStep();
          }}
          items={[{ id: "add", label: t("forms.steps.add") }]}
        />
      </div>
      <ol className="qcms-rail__group" aria-label={t("forms.rail.steps")} data-rail-group="steps">
        {builder.draft.steps.map((step, index) => (
          <li key={step.stepId}>
            <StepRow
              stepId={step.stepId}
              title={textOf(step.title) === "" ? t("forms.steps.untitled") : textOf(step.title)}
              position={index + 1}
              total={builder.draft.steps.length}
              issueCount={builder.issueCounts.get(step.stepId) ?? 0}
              isSelected={
                builder.selection.kind === "step" && builder.selection.stepId === step.stepId
              }
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
            {groupsOf(step).length > 0 && (
              <ol
                className="qcms-rail__group qcms-rail-steps__groups"
                aria-label={t("forms.group.railGroups")}
                data-rail-group="groups"
              >
                {groupsOf(step).map((group, at) => (
                  <li key={group.groupId}>
                    <GroupRow
                      groupId={group.groupId}
                      label={
                        textOf(group.label) === "" ? t("forms.group.untitled") : textOf(group.label)
                      }
                      position={at + 1}
                      total={groupsOf(step).length}
                      isSelected={
                        builder.selection.kind === "group" &&
                        builder.selection.groupId === group.groupId
                      }
                      onSelect={() => {
                        builder.chooseGroup(step.stepId, group.groupId);
                      }}
                      onMove={(delta) => {
                        builder.moveGroup(step.stepId, group.groupId, delta);
                      }}
                      onRemove={() => {
                        builder.removeGroup(group.groupId);
                      }}
                    />
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function ServerSteps({ items }: { readonly items: readonly RailItem[] }) {
  if (items.length === 0) return null;
  return (
    <ol className="qcms-rail__group" aria-label={t("forms.rail.steps")} data-rail-group="steps">
      {items.map((item) => (
        <li
          key={item.key}
          {...(item.anchorId === undefined ? {} : { id: item.anchorId })}
          tabIndex={-1}
        >
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

/* Reorder through menu commands so keyboard and motor-impaired users have the same path as pointer users. */
function StepRow({
  stepId,
  title,
  position,
  total,
  issueCount,
  isSelected,
  onSelect,
  onRename,
  onMove,
  onRemove,
}: {
  readonly stepId: string;
  readonly title: string;
  readonly position: number;
  readonly total: number;
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

      <Menu
        triggerLabel={t("forms.steps.menu", { title })}
        trigger={<span aria-hidden="true">{"⋮"}</span>}
        menuLabel={t("forms.steps.menu", { title })}
        classNames={menuClasses("qcms-rail-steps__menu")}
        disabledKeys={disabledCommands(position, total)}
        onAction={(key) => {
          if (key === "rename") {
            setDraftTitle(title);
            setRenaming(true);
          } else if (key === "up") onMove(-1);
          else if (key === "down") onMove(1);
          else if (key === "remove") setRemoving(true);
        }}
        items={[
          { id: "rename", label: t("forms.steps.rename") },
          { id: "up", label: t("forms.steps.moveUp") },
          { id: "down", label: t("forms.steps.moveDown") },
          { id: "remove", label: t("forms.steps.remove") },
        ]}
      />

      {/* This is a programmatic focus destination, not an additional Tab stop. */}
      <span id={stepAnchorId(stepId)} tabIndex={-1} className="qcms-visually-hidden">
        {title}
      </span>

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

function groupsOf(step: DraftStep): readonly DraftGroup[] {
  return step.items.filter(isDraftGroup);
}

function GroupRow({
  groupId,
  label,
  position,
  total,
  isSelected,
  onSelect,
  onMove,
  onRemove,
}: {
  readonly groupId: string;
  readonly label: string;
  readonly position: number;
  readonly total: number;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
  readonly onMove: (delta: -1 | 1) => void;
  readonly onRemove: () => void;
}) {
  const [removing, setRemoving] = useState(false);
  return (
    <div className="qcms-rail-steps__row">
      <button
        type="button"
        className="qcms-rail__link qcms-rail-steps__select"
        data-rail-group-select={label}
        data-rail-group-id={groupId}
        aria-current={isSelected ? "page" : undefined}
        onClick={onSelect}
      >
        <span className="qcms-visually-hidden">{t("forms.group.select", { label })}</span>
        <span aria-hidden="true">{label}</span>
      </button>

      <Menu
        triggerLabel={t("forms.group.menu", { label })}
        trigger={<span aria-hidden="true">{"\u22ee"}</span>}
        menuLabel={t("forms.group.menu", { label })}
        classNames={menuClasses("qcms-rail-steps__menu")}
        disabledKeys={disabledCommands(position, total)}
        onAction={(key) => {
          if (key === "up") onMove(-1);
          else if (key === "down") onMove(1);
          else if (key === "remove") setRemoving(true);
        }}
        items={[
          { id: "up", label: t("forms.group.moveUp") },
          { id: "down", label: t("forms.group.moveDown") },
          { id: "remove", label: t("forms.group.remove") },
        ]}
      />

      {/* The rail and selected grid boundary share a group focus id; either destination is valid when both exist. */}
      <span id={groupAnchorId(groupId)} tabIndex={-1} className="qcms-visually-hidden">
        {label}
      </span>

      {removing && (
        <Dialog
          isOpen
          role="alertdialog"
          title={t("forms.group.confirmRemoveTitle", { label })}
          description={t("forms.group.confirmRemoveBody")}
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
              {t("forms.group.confirmRemove")}
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

function disabledCommands(position: number, total: number): string[] {
  const disabled: string[] = [];
  if (position === 1) disabled.push("up");
  if (position === total) disabled.push("down");
  return disabled;
}
