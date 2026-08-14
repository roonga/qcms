"use client";

import { useState } from "react";

import {
  Button,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MenuTriggerButton,
} from "@/components/kit";
import { pinLabel, pinnableVersions, pinnedVersionStatus } from "@/lib/forms/draft";
import { messageForIssue, pinAnchorId } from "@/lib/forms/issues";
import type {
  DraftForm,
  DraftPin,
  DraftStep,
  FormIssue,
  PinnableQuestion,
} from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { textOf } from "@/lib/questions/definition";

import { LibraryPicker } from "./library-picker";

/**
 * One step's pinned questions (task 033; wireframe "step editor").
 *
 * ## Every row says `questionId@version`, out loud
 *
 * That string is the product's governance model in six characters, and it is why the row
 * shows it in monospace rather than showing a friendly label with the version tucked into
 * a tooltip. An author looking at this list can see, without opening anything, exactly
 * which frozen definition each question in this form will serve - which is the property
 * that makes a questionnaire reproducible years later (R6).
 *
 * ## The move menu is the only version change in the builder
 *
 * It moves **one pin** to **one version**, and the versions it offers are the published
 * ones (`pinnableVersions`). There is no "move everything to v3" and no automatic upgrade
 * anywhere, and that absence is the feature R7 protects: an author who published question
 * v3 last week must still see v2 here, because the alternative is a form whose meaning
 * changed without anyone deciding it should.
 *
 * A pin pointing at a version that has since been **deprecated** keeps working and is
 * flagged rather than fixed. Same rule from the other side: deprecation blocks *new* pins,
 * it does not reach into forms that already made one.
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
  readonly library: readonly PinnableQuestion[];
  readonly issues: readonly FormIssue[];
  readonly onAddPin: (questionId: string, version: number) => void;
  readonly onMovePin: (questionId: string, version: number) => void;
  readonly onRemovePin: (questionId: string) => void;
  readonly onReorderPin: (questionId: string, delta: -1 | 1) => void;
}) {
  const [isPickerOpen, setPickerOpen] = useState(false);
  const title = textOf(step.title) === "" ? t("forms.steps.untitled") : textOf(step.title);

  return (
    <section
      aria-labelledby="qcms-step-heading"
      className="flex flex-col gap-4 rounded-md border border-(--color-border) bg-(--color-surface) p-4"
    >
      <h2 id="qcms-step-heading" className="text-base font-semibold text-(--color-text)">
        {t("forms.step.heading", { title })}
      </h2>
      <p className="text-sm text-(--color-text-muted)">{t("forms.step.pinNote")}</p>

      {step.items.length === 0 ? (
        <p className="text-sm text-(--color-text-muted)">{t("forms.step.empty")}</p>
      ) : (
        <ul aria-label={t("forms.step.pins")} className="flex flex-col gap-3">
          {step.items.map((pin, index) => (
            <li key={pin.questionId}>
              <PinRow
                pin={pin}
                position={index + 1}
                total={step.items.length}
                question={library.find((entry) => entry.questionId === pin.questionId)}
                issues={issuesForPin(issues, pin.questionId)}
                onMovePin={onMovePin}
                onRemovePin={onRemovePin}
                onReorderPin={onReorderPin}
              />
            </li>
          ))}
        </ul>
      )}

      <div>
        <Button
          variant="secondary"
          size="md"
          onPress={() => {
            setPickerOpen(true);
          }}
        >
          {t("forms.step.addQuestion")}
        </Button>
      </div>

      {isPickerOpen && (
        <LibraryPicker
          isOpen
          stepTitle={title}
          draft={draft}
          library={library}
          onPin={onAddPin}
          onClose={() => {
            setPickerOpen(false);
          }}
        />
      )}
    </section>
  );
}

/** The issues that belong to one pin: about this question, and not about a rule. */
function issuesForPin(issues: readonly FormIssue[], questionId: string): readonly FormIssue[] {
  return issues.filter(
    (issue) => issue.path?.question === questionId && issue.path?.rule === undefined,
  );
}

function PinRow({
  pin,
  position,
  total,
  question,
  issues,
  onMovePin,
  onRemovePin,
  onReorderPin,
}: {
  readonly pin: DraftPin;
  readonly position: number;
  readonly total: number;
  readonly question: PinnableQuestion | undefined;
  readonly issues: readonly FormIssue[];
  readonly onMovePin: (questionId: string, version: number) => void;
  readonly onRemovePin: (questionId: string) => void;
  readonly onReorderPin: (questionId: string, delta: -1 | 1) => void;
}) {
  const others = pinnableVersions(question ?? emptyQuestion(pin.questionId)).filter(
    (version) => version !== pin.version,
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {/* Both the identity an author reads and the focus destination the validation
            panel sends focus to, so an issue about this pin lands on the pin itself. */}
        <span id={pinAnchorId(pin.questionId)} tabIndex={-1} className="qcms-question-id">
          {pinLabel(pin)}
        </span>
        <span className="text-sm text-(--color-text-muted)">
          {textOf(question?.label ?? undefined)}
        </span>
        <PinStateTag question={question} pin={pin} />

        <MenuTrigger>
          <MenuTriggerButton
            aria-label={t("forms.step.movePin", { questionId: pin.questionId })}
            className="rounded-md border border-(--color-border) px-2 py-1 text-sm text-(--color-text) hover:bg-(--color-surface-hover)"
          >
            {t("forms.step.movePin", { questionId: pin.questionId })}
          </MenuTriggerButton>
          <MenuPopover className="qcms-menu">
            <MenuList
              className="qcms-menu__list"
              aria-label={t("forms.step.movePin", { questionId: pin.questionId })}
              onAction={(key) => {
                const version = Number.parseInt(String(key), 10);
                if (Number.isInteger(version)) onMovePin(pin.questionId, version);
              }}
            >
              {others.length === 0 ? (
                <MenuItem id="none" className="qcms-menu__item" isDisabled>
                  {t("forms.step.movePinNone")}
                </MenuItem>
              ) : (
                others.map((version) => (
                  <MenuItem key={version} id={String(version)} className="qcms-menu__item">
                    {t("forms.step.movePinTo", { version })}
                  </MenuItem>
                ))
              )}
            </MenuList>
          </MenuPopover>
        </MenuTrigger>

        <Button
          variant="ghost"
          size="sm"
          isDisabled={position === 1}
          onPress={() => {
            onReorderPin(pin.questionId, -1);
          }}
        >
          {t("forms.step.pinUp", { questionId: pin.questionId })}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          isDisabled={position === total}
          onPress={() => {
            onReorderPin(pin.questionId, 1);
          }}
        >
          {t("forms.step.pinDown", { questionId: pin.questionId })}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onPress={() => {
            onRemovePin(pin.questionId);
          }}
        >
          {t("forms.step.removePin", { questionId: pin.questionId })}
        </Button>
      </div>

      {issues.length > 0 && (
        <ul className="flex flex-col gap-1">
          {issues.map((issue, index) => (
            <li
              key={`${issue.code}:${String(index)}`}
              className="text-sm text-(--color-danger-fg)"
              data-issue-code={issue.code}
            >
              {messageForIssue(issue)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A stand-in so the version helpers can be asked about a question the library lost. */
function emptyQuestion(questionId: string): PinnableQuestion {
  return { questionId, slug: questionId, label: null, type: null, versions: [] };
}

/**
 * What the pinned version's own status is, when it is worth saying.
 *
 * Nothing is rendered for the ordinary case (a pin at a published version), because a tag
 * on every row would say nothing. The three cases that are worth a word are a deprecated
 * version, a version that is somehow still a draft, and a version the library no longer
 * reports at all.
 */
function PinStateTag({
  question,
  pin,
}: {
  readonly question: PinnableQuestion | undefined;
  readonly pin: DraftPin;
}) {
  const status = pinnedVersionStatus(question, pin.version);
  if (status === "published") return null;
  const label = pinStateLabel(status);
  return (
    <span className="qcms-tag qcms-tag--deprecated" data-pin-state={status ?? "missing"}>
      {label}
    </span>
  );
}

function pinStateLabel(status: string | undefined): string {
  if (status === "deprecated") return t("forms.step.pinDeprecated");
  if (status === "draft") return t("forms.step.pinDraft");
  return t("forms.step.pinMissing");
}
