"use client";

import { useState, useTransition, type ReactNode } from "react";

import {
  Alert,
  Button,
  Dialog,
  RadioButton,
  RadioField,
  RadioGroup,
  TextField,
} from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { formatList } from "@/lib/i18n/format";
import {
  IDLE_ACT,
  type Account,
  type AccountActState,
  type AccountControls,
  type BlockedReason,
  type ControlState,
  type ResetChoice,
} from "@/lib/site/accounts";

export interface StepUpCredentials {
  readonly password: string;
  readonly code: string;
}

type Open = "none" | "resend" | "reset" | "disable" | "reactivate";

function blockedText(reason: BlockedReason, name: string, act: "disable" | "reset"): string {
  if (reason === "lastSiteAdministrator") {
    return act === "disable"
      ? t("site.accounts.blocked.lastDisable", { person: name })
      : t("site.accounts.blocked.lastReset", { person: name });
  }
  return t("site.accounts.blocked.own");
}

/** The account page's acts: each opens a confirmation, and an act on a Site administrator asks for a step-up inside it. */
export function AccountActions({
  account,
  controls,
  holdingsSummary,
  lastAdministratorOf,
  locale,
  resend,
  disable,
  reactivate,
  reset,
}: {
  readonly account: Account;
  readonly controls: AccountControls;
  /** One line per workspace the account holds something in. */
  readonly holdingsSummary: readonly string[];
  readonly lastAdministratorOf: readonly string[];
  readonly locale: string;
  readonly resend: (userId: string) => Promise<AccountActState>;
  readonly disable: (userId: string, credentials?: StepUpCredentials) => Promise<AccountActState>;
  readonly reactivate: (userId: string) => Promise<AccountActState>;
  readonly reset: (
    userId: string,
    choice: ResetChoice,
    credentials?: StepUpCredentials,
  ) => Promise<AccountActState>;
}) {
  const [open, setOpen] = useState<Open>("none");
  const [outcome, setOutcome] = useState<AccountActState>(IDLE_ACT);
  const [failure, setFailure] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<ResetChoice>("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const name = account.name;
  const close = () => {
    setOpen("none");
    setFailure(undefined);
    setPassword("");
    setCode("");
  };
  const begin = (next: Open) => {
    setOutcome(IDLE_ACT);
    setFailure(undefined);
    setOpen(next);
  };
  const run = (act: () => Promise<AccountActState>) => {
    startTransition(async () => {
      const result = await act();
      if (result.status === "error" && result.code !== "UNDELIVERABLE") {
        setFailure(result.message);
        setPassword("");
        return;
      }
      close();
      setOutcome(result);
    });
  };
  const credentials = (): StepUpCredentials | undefined =>
    controls.stepUp ? { password, code } : undefined;
  const stepUpReady = !controls.stepUp || (password !== "" && /^\d{6}$/u.test(code));

  const stepUpFields = controls.stepUp && (
    <div className="flex flex-col gap-3" data-testid="qcms-step-up">
      <p className="text-sm">{t("site.stepUp.intro")}</p>
      <p className="text-sm">
        {controls.approval === "needsApprover"
          ? t("site.stepUp.needsApprover")
          : t("site.stepUp.alone")}
      </p>
      <TextField
        label={t("site.stepUp.password")}
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
        autoFocus
        isRequired
        isDisabled={pending}
      />
      <TextField
        label={t("site.stepUp.code")}
        description={t("site.stepUp.codeHint")}
        value={code}
        onChange={setCode}
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        isRequired
        isDisabled={pending}
      />
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="qcms-account-actions">
      {outcome.status === "done" && <Alert variant="success">{outcome.message}</Alert>}
      {outcome.status === "held" && <Alert variant="info">{outcome.message}</Alert>}
      {outcome.status === "error" && <Alert variant="error">{outcome.message}</Alert>}

      <div className="flex flex-wrap items-start gap-3">
        {controls.resend && (
          <Button variant="secondary" size="md" onPress={() => begin("resend")}>
            {t("site.accounts.resend.act")}
          </Button>
        )}
        <Gated
          control={controls.reset}
          reason={(blocked) => blockedText(blocked, name, "reset")}
          testId="qcms-account-reset"
        >
          {(isDisabled) => (
            <Button
              variant="secondary"
              size="md"
              isDisabled={isDisabled}
              onPress={() => begin("reset")}
            >
              {t("site.accounts.reset.open")}
            </Button>
          )}
        </Gated>
        {controls.reactivate && (
          <Button variant="primary" size="md" onPress={() => begin("reactivate")}>
            {t("site.accounts.reactivate.act")}
          </Button>
        )}
        <Gated
          control={controls.disable}
          reason={(blocked) => blockedText(blocked, name, "disable")}
          testId="qcms-account-disable"
        >
          {(isDisabled) => (
            <Button
              variant="danger"
              size="md"
              isDisabled={isDisabled}
              onPress={() => begin("disable")}
            >
              {t("site.accounts.disable.act")}
            </Button>
          )}
        </Gated>
      </div>

      {open === "resend" && (
        <ActDialog
          title={t("site.accounts.resend.title", { name })}
          act={t("site.accounts.resend.act")}
          pending={pending}
          error={failure}
          onCancel={close}
          onConfirm={() => run(() => resend(account.userId))}
        >
          <p className="text-sm">{t("site.accounts.resend.body")}</p>
        </ActDialog>
      )}

      {open === "reactivate" && (
        <ActDialog
          title={t("site.accounts.reactivate.title", { name })}
          act={t("site.accounts.reactivate.act")}
          pending={pending}
          error={failure}
          onCancel={close}
          onConfirm={() => run(() => reactivate(account.userId))}
        >
          <p className="text-sm">{t("site.accounts.reactivate.body")}</p>
          <p className="text-sm">{t("site.accounts.reactivate.suspended")}</p>
        </ActDialog>
      )}

      {open === "reset" && (
        <ActDialog
          title={t("site.accounts.reset.title", { name })}
          act={
            choice === "factor"
              ? t("site.accounts.reset.actFactor")
              : t("site.accounts.reset.actPassword")
          }
          pending={pending}
          ready={stepUpReady}
          error={failure}
          onCancel={close}
          onConfirm={() => run(() => reset(account.userId, choice, credentials()))}
        >
          <div className="flex flex-col gap-2">
            <span id="qcms-reset-choice" className="text-sm font-medium">
              {t("site.accounts.reset.choice")}
            </span>
            <RadioGroup
              className="flex flex-col gap-3"
              aria-labelledby="qcms-reset-choice"
              value={choice}
              isDisabled={pending}
              onChange={(next) => setChoice(next === "factor" ? "factor" : "password")}
            >
              <RadioField value="password">
                <RadioButton className="qcms-radio">
                  <span className="qcms-radio__dot" aria-hidden="true" />
                  <span className="flex flex-col">
                    <span>{t("site.accounts.reset.password")}</span>
                    <span className="text-sm text-(--color-text-muted)">
                      {t("site.accounts.reset.passwordHint")}
                    </span>
                  </span>
                </RadioButton>
              </RadioField>
              <RadioField value="factor">
                <RadioButton className="qcms-radio">
                  <span className="qcms-radio__dot" aria-hidden="true" />
                  <span className="flex flex-col">
                    <span>{t("site.accounts.reset.factor")}</span>
                    <span className="text-sm text-(--color-text-muted)">
                      {t("site.accounts.reset.factorHint")}
                    </span>
                  </span>
                </RadioButton>
              </RadioField>
            </RadioGroup>
          </div>
          <p className="text-sm">{t("site.accounts.reset.effect")}</p>
          {stepUpFields}
        </ActDialog>
      )}

      {open === "disable" && (
        <ActDialog
          title={t("site.accounts.disable.title", { name })}
          act={t("site.accounts.disable.act")}
          tone="danger"
          pending={pending}
          ready={stepUpReady}
          error={failure}
          onCancel={close}
          onConfirm={() => run(() => disable(account.userId, credentials()))}
        >
          <p className="text-sm">{t("site.accounts.disable.body")}</p>
          {holdingsSummary.length === 0 ? (
            <p className="text-sm">{t("site.accounts.holds.none")}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm" data-testid="qcms-disable-holdings">
              {holdingsSummary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {lastAdministratorOf.length > 0 && (
            <p className="text-sm text-(--color-warning-fg)" data-testid="qcms-disable-last-admin">
              {t("site.accounts.disable.lastAdministrator", {
                workspaces: formatList(lastAdministratorOf, locale),
              })}
            </p>
          )}
          {stepUpFields}
        </ActDialog>
      )}
    </div>
  );
}

function Gated({
  control,
  reason,
  testId,
  children,
}: {
  readonly control: ControlState;
  readonly reason: (blocked: BlockedReason) => string;
  readonly testId: string;
  readonly children: (isDisabled: boolean) => ReactNode;
}) {
  if (!control.shown) return null;
  const blocked = control.blocked;
  return (
    <div className="flex min-w-0 max-w-sm flex-col items-start gap-1" data-testid={testId}>
      {children(blocked !== undefined)}
      {blocked !== undefined && (
        <p className="text-sm text-(--color-text-muted)">{reason(blocked)}</p>
      )}
    </div>
  );
}

function ActDialog({
  title,
  act,
  tone = "primary",
  pending,
  ready = true,
  error,
  onConfirm,
  onCancel,
  children,
}: {
  readonly title: string;
  readonly act: string;
  readonly tone?: "primary" | "danger";
  readonly pending: boolean;
  readonly ready?: boolean;
  readonly error: string | undefined;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly children: ReactNode;
}) {
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
          if (ready && !pending) onConfirm();
        }}
      >
        {children}
        {error !== undefined && <Alert variant="error">{error}</Alert>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="md" isDisabled={pending} onPress={onCancel}>
            {t("access.confirm.cancel")}
          </Button>
          <Button type="submit" variant={tone} size="md" isDisabled={!ready || pending}>
            {pending ? t("site.accounts.act.working") : act}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
