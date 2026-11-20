"use client";

import { useState, type ReactNode } from "react";

import { Alert, Button, Dialog, TextField } from "@/components/kit";
import { t } from "@/lib/i18n/en";

export interface StepUpCredentials {
  readonly password: string;
  readonly code: string;
}

/** Password and current code, as typed; ready once both are there. */
export function useStepUpFields() {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  return {
    password,
    code,
    setPassword,
    setCode,
    ready: password !== "" && /^\d{6}$/u.test(code),
    clear: () => {
      setPassword("");
      setCode("");
    },
    clearPassword: () => setPassword(""),
    credentials: (): StepUpCredentials => ({ password, code }),
  };
}

export type StepUpFieldState = ReturnType<typeof useStepUpFields>;

/** The step-up's two fields. The password is never echoed back, and the code takes no autocomplete. */
export function StepUpFields({
  fields,
  approvalText,
  pending,
}: {
  readonly fields: StepUpFieldState;
  readonly approvalText?: string;
  readonly pending: boolean;
}) {
  return (
    <div className="flex flex-col gap-3" data-testid="qcms-step-up">
      <p className="text-sm">{t("site.stepUp.intro")}</p>
      {approvalText !== undefined && <p className="text-sm">{approvalText}</p>}
      <TextField
        label={t("site.stepUp.password")}
        type="password"
        value={fields.password}
        onChange={fields.setPassword}
        autoComplete="current-password"
        autoFocus
        isRequired
        isDisabled={pending}
      />
      <TextField
        label={t("site.stepUp.code")}
        description={t("site.stepUp.codeHint")}
        value={fields.code}
        onChange={fields.setCode}
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        isRequired
        isDisabled={pending}
      />
    </div>
  );
}

/** The step-up dialog, named for the act it confirms; nothing is sent until it confirms. */
export function StepUpDialog({
  title,
  act,
  tone = "primary",
  approvalText,
  pending,
  error,
  onConfirm,
  onCancel,
  children,
}: {
  readonly title: string;
  readonly act: string;
  readonly tone?: "primary" | "danger";
  readonly approvalText?: string;
  readonly pending: boolean;
  readonly error: string | undefined;
  readonly onConfirm: (credentials: StepUpCredentials) => void;
  readonly onCancel: () => void;
  readonly children?: ReactNode;
}) {
  const fields = useStepUpFields();
  return (
    <Dialog
      isOpen
      title={title}
      isDismissable={!pending}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!fields.ready || pending) return;
          onConfirm(fields.credentials());
          // A refused step-up is retyped, never resent as it was.
          fields.clearPassword();
        }}
      >
        {children}
        <StepUpFields
          fields={fields}
          pending={pending}
          {...(approvalText === undefined ? {} : { approvalText })}
        />
        {error !== undefined && <Alert variant="error">{error}</Alert>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="md" isDisabled={pending} onPress={onCancel}>
            {t("access.confirm.cancel")}
          </Button>
          <Button type="submit" variant={tone} size="md" isDisabled={!fields.ready || pending}>
            {pending ? t("site.stepUp.working") : act}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
