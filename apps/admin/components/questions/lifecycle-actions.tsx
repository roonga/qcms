"use client";

import { useActionState, useEffect, useState } from "react";

import { Alert, Button, Dialog } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { IDLE_MUTATION, type MutationState } from "@/lib/questions/editor-state";
import type { QuestionStatus } from "@/lib/questions/types";

type Intent = "publish" | "newVersion" | "deprecate";

interface LifecycleProps {
  readonly action: (state: MutationState, formData: FormData) => Promise<MutationState>;
  readonly questionId: string;
  readonly version: number;
  readonly status: QuestionStatus;
  readonly latestVersion: number;
}

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
