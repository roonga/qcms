"use client";

import { useState, type ReactNode } from "react";

import { Alert, Button, Dialog, TextField } from "@/components/kit";
import { t } from "@/lib/i18n/en";

export type ConfirmLevel =
  | { readonly kind: "plain" }
  /** Irreversible acts: the confirm button stays off until `name` is typed exactly. */
  | { readonly kind: "typed"; readonly name: string };

/** A confirmation that names its act on the button, shows the caller's preview, and gates irreversible acts on a typed name. */
export function ConfirmAct({
  title,
  act,
  level,
  tone = "primary",
  preview,
  needsApproval = false,
  pending = false,
  error,
  onConfirm,
  onCancel,
}: {
  readonly title: string;
  /** The button's words: the act itself, never "OK" or "Confirm". */
  readonly act: string;
  readonly level: ConfirmLevel;
  readonly tone?: "primary" | "danger";
  readonly preview?: ReactNode;
  /** The act waits for an Approver, so the button sends a request instead. */
  readonly needsApproval?: boolean;
  readonly pending?: boolean;
  readonly error?: string | undefined;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const matched = level.kind === "plain" || typed === level.name;

  return (
    <Dialog
      isOpen
      role={level.kind === "typed" ? "alertdialog" : "dialog"}
      title={title}
      isDismissable={!pending}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <div className="flex flex-col gap-4">
        {preview}
        {level.kind === "typed" && (
          <TextField
            label={t("access.confirm.typedLabel", { name: level.name })}
            description={t("access.confirm.typedHint")}
            value={typed}
            autoComplete="off"
            isDisabled={pending}
            isInvalid={typed !== "" && !matched}
            errorMessage={t("access.confirm.typedMismatch", { name: level.name })}
            onChange={setTyped}
          />
        )}
        {error !== undefined && <Alert variant="error">{error}</Alert>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant={tone}
            size="md"
            isDisabled={!matched || pending}
            onPress={onConfirm}
          >
            {pending
              ? t("access.confirm.working")
              : needsApproval
                ? t("access.preview.requestApproval")
                : act}
          </Button>
          <Button variant="secondary" size="md" isDisabled={pending} onPress={onCancel}>
            {t("access.confirm.cancel")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
