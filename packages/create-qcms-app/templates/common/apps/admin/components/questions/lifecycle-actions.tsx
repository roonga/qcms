"use client";

import { useActionState, useEffect, useState } from "react";

import { Alert, Button, Dialog } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { IDLE_MUTATION, type MutationState } from "@/lib/questions/editor-state";
import type { QuestionStatus } from "@/lib/questions/types";

/**
 * Publish, new version, deprecate (task 032; screen contract "lifecycle actions").
 *
 * ## Where these render, and why it is a column
 *
 * In the rail, pinned above the version list, which is where the screen's own POC draws them
 * (`plan/admin-shell-poc/question-editor-poc.html`, issue 650). Its reason is worth keeping
 * beside the code: the version list is the one thing on this screen that grows without bound,
 * so an action anchored below it would drift further down the rail with every version the
 * question accumulates, while up here it stays at a fixed place a hand can learn.
 *
 * So the buttons stack rather than sitting in a row, and each fills the 240px track: they are
 * in a column now, and a wrapped row of three would read as a paragraph of controls. The
 * width comes from `app/globals.css` rather than from a prop, because the vendored `Button`
 * takes a variant and a size and no class name, and wrapping it here to add one would be the
 * start of a second design language outside `packages/ui` (ADR-22).
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

export function LifecycleActions({
  action,
  questionId,
  version,
  status,
  latestVersion,
}: {
  readonly action: (state: MutationState, formData: FormData) => Promise<MutationState>;
  readonly questionId: string;
  readonly version: number;
  readonly status: QuestionStatus;
  readonly latestVersion: number;
}) {
  const [open, setOpen] = useState<Intent | null>(null);
  const next = latestVersion + 1;

  return (
    <div className="qcms-question-rail__lifecycle">
      {/* New version first, and that is the POC's order rather than a ranking of the three.
          It is the one control that is offered whatever the selected version's status, so
          first is the only position it can hold without the buttons below it moving as an
          author walks the version list. */}
      <Button
        variant="secondary"
        size="sm"
        onPress={() => {
          setOpen("newVersion");
        }}
      >
        {t("questions.action.newVersion")}
      </Button>
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
          next={next}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </div>
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
