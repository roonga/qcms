"use client";

import { useActionState, useEffect, useState } from "react";

import { Alert, Button, Dialog } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { IDLE_MUTATION, type MutationState } from "@/lib/questions/editor-state";
import type { QuestionStatus } from "@/lib/questions/types";

/**
 * Publish, new version, deprecate (task 032; screen contract "lifecycle actions").
 *
 * ## Two components now, because the three controls live in two places (§7.0, issue #1116)
 *
 * They were one block, stacked in the rail above the version list, which is where this
 * screen's POC draws them (`plan/admin-shell-poc/question-editor-poc.html`, issue 650). The
 * 2026-10-24 ruling splits them by KIND rather than by taste: "lifecycle actions live in the
 * content heading row only ... the rail never holds a lifecycle or destructive action", and
 * "New version stays in the rail as a structural action".
 *
 * So {@link NewVersionAction} is the rail's Actions part and {@link VersionLifecycleActions}
 * is the screen's heading row, beside Save. The POC's reason for pinning the block above the
 * version list is answered rather than overruled: the list is the one thing on this screen
 * that grows without bound, and the Actions part sits at the foot of the rail, so the one
 * control left there is the one that is offered whatever the selected version's status and
 * never moves as an author walks the list.
 *
 * Publish and Deprecate in the heading row also put them where the form screens put theirs,
 * which is what "the rail looks and behaves the same everywhere" costs: a reader who has
 * learned where a consequential action lives on one screen finds it in the same place here.
 *
 * New version is `ghost` for the reason `rail-add-step.tsx` records about Add step: the kit's
 * `secondary` is a solid slate fill, so in a column of quiet rows it read as the loudest
 * thing on the screen and as the primary action of the whole screen, which it is not. Publish
 * and Deprecate keep their variants - they are the consequential actions this screen is
 * about, and the POC colours them.
 *
 * ## The confirmations are the teaching surface
 *
 * ADR-02 makes the governed library the product's identity, and these three dialogs are
 * where an author meets the governance for the first time. So none of them asks "are you
 * sure?" - each states the consequence and the escape hatch: publishing freezes content
 * for good and the way to change it is version N+1; deprecating blocks new pins and
 * leaves every existing form untouched. An author who reads the dialog once has the whole
 * versioning model.
 *
 * `role="alertdialog"` on all three because each is a confirmation of a consequential,
 * one-way action; react-aria supplies the focus trap and the return-focus-on-close that
 * the screen contract's a11y note asks for.
 *
 * ## Why each dialog owns its own submission state
 *
 * A confirmation has to stay open when the API refuses (so the reason is read where the
 * decision was made) and close when it succeeds. With one shared action state that is a
 * puzzle: "saved" from the previous action is still "saved" when the next dialog opens, so
 * a freshly opened dialog closes itself. Mounting each dialog fresh - the state lives
 * inside `ConfirmDialog`, which only exists while it is open - makes the rule trivially
 * correct instead of carefully correct.
 */

type Intent = "publish" | "newVersion" | "deprecate";

/** What both components need to post one of the three intents. */
interface LifecycleProps {
  readonly action: (state: MutationState, formData: FormData) => Promise<MutationState>;
  readonly questionId: string;
  readonly version: number;
  readonly status: QuestionStatus;
  readonly latestVersion: number;
}

/**
 * New version, in the rail's Actions part.
 *
 * Offered whatever the selected version's status, which is why it is the one control that
 * can live at a fixed place in the rail: nothing above or below it appears and disappears
 * as an author walks the version list.
 */
export function NewVersionAction({
  action,
  questionId,
  version,
  latestVersion,
}: Omit<LifecycleProps, "status">) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onPress={() => {
          setOpen(true);
        }}
      >
        {t("questions.action.newVersion")}
      </Button>
      {open && (
        <ConfirmDialog
          action={action}
          intent="newVersion"
          questionId={questionId}
          version={version}
          next={latestVersion + 1}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

/**
 * Publish and Deprecate, in the screen's one heading row (§7.0 ruling 5, issue #1116).
 *
 * At most one of them is ever rendered: a draft can be published and a published version can
 * be deprecated, and a deprecated one offers neither. The row holds one control's height
 * whether or not a control is in it (`app/globals.css`), so the heading does not move as a
 * reader walks from a draft to a frozen version - the same rule Save already relies on.
 */
export function VersionLifecycleActions({
  action,
  questionId,
  version,
  status,
  latestVersion,
}: LifecycleProps) {
  const [open, setOpen] = useState<Intent | null>(null);

  return (
    <>
      {status === "draft" && (
        <Button
          variant="primary"
          size="sm"
          onPress={() => {
            setOpen("publish");
          }}
        >
          {t("questions.action.publish", { version })}
        </Button>
      )}
      {status === "published" && (
        <Button
          variant="danger"
          size="sm"
          onPress={() => {
            setOpen("deprecate");
          }}
        >
          {t("questions.action.deprecate", { version })}
        </Button>
      )}
      {open !== null && (
        <ConfirmDialog
          action={action}
          intent={open}
          questionId={questionId}
          version={version}
          next={latestVersion + 1}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </>
  );
}

/** The wording of one confirmation: title, body, and the verb on the confirm button. */
function copyFor(intent: Intent, version: number, next: number) {
  if (intent === "publish") {
    return {
      title: t("questions.confirm.publishTitle", { version }),
      body: t("questions.confirm.publishBody", { next }),
      confirm: t("questions.confirm.publishConfirm"),
      variant: "primary" as const,
    };
  }
  if (intent === "newVersion") {
    return {
      title: t("questions.confirm.newVersionTitle", { next }),
      body: t("questions.confirm.newVersionBody", { next, version }),
      confirm: t("questions.confirm.newVersionConfirm"),
      variant: "primary" as const,
    };
  }
  return {
    title: t("questions.confirm.deprecateTitle", { version }),
    body: t("questions.confirm.deprecateBody"),
    confirm: t("questions.confirm.deprecateConfirm"),
    variant: "danger" as const,
  };
}

function ConfirmDialog({
  action,
  intent,
  questionId,
  version,
  next,
  onClose,
}: {
  readonly action: (state: MutationState, formData: FormData) => Promise<MutationState>;
  readonly intent: Intent;
  readonly questionId: string;
  readonly version: number;
  readonly next: number;
  readonly onClose: () => void;
}) {
  const [state, formAction, isPending] = useActionState(action, IDLE_MUTATION);
  const copy = copyFor(intent, version, next);

  // Success closes; a refusal keeps the dialog open with the reason inside it. This state
  // starts fresh on every open (the component is mounted by the button that opened it),
  // so "saved" here can only ever mean this submission.
  useEffect(() => {
    if (state.status === "saved") onClose();
  }, [state.status, onClose]);

  return (
    <Dialog
      isOpen
      role="alertdialog"
      title={copy.title}
      description={copy.body}
      isDismissable={!isPending}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="intent" value={intent} />
        <input type="hidden" name="questionId" value={questionId} />
        <input type="hidden" name="version" value={String(version)} />
        {state.status === "error" && <Alert variant="error">{state.message}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant={copy.variant} size="md" isDisabled={isPending}>
            {copy.confirm}
          </Button>
          <Button variant="ghost" size="md" isDisabled={isPending} onPress={onClose}>
            {t("questions.action.cancel")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
