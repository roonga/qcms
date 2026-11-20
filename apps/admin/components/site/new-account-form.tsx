"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";

import { Alert, Button, TextField } from "@/components/kit";
import { useIsHydrated } from "@/lib/hydrated";
import { t } from "@/lib/i18n/en";
import {
  accountHref,
  IDLE_ACT,
  IDLE_CREATE,
  type AccountActState,
  type CreateAccountState,
} from "@/lib/site/accounts";

export function NewAccountForm({
  create,
  resend,
}: {
  readonly create: (state: CreateAccountState, formData: FormData) => Promise<CreateAccountState>;
  readonly resend: (userId: string) => Promise<AccountActState>;
}) {
  const [state, formAction, isPending] = useActionState(create, IDLE_CREATE);
  const isHydrated = useIsHydrated();
  const [resent, setResent] = useState<AccountActState>(IDLE_ACT);
  const [resending, startResend] = useTransition();
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    setResent(IDLE_ACT);
  }
  const submitted = state.status === "error" ? state.submitted : { email: "", name: "" };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {state.status === "sent" && (
        <div data-testid="qcms-account-created">
          <Alert variant="success">
            <span className="flex flex-col gap-1">
              <span>{t("site.accounts.create.sent", { email: state.email })}</span>
              <Link className="qcms-text-link" href={accountHref(state.userId)}>
                {t("site.accounts.create.open", { name: state.name })}
              </Link>
            </span>
          </Alert>
        </div>
      )}
      {state.status === "undeliverable" && (
        <div className="flex flex-col items-start gap-2" data-testid="qcms-account-created">
          <Alert variant="error">
            {t("site.accounts.create.undeliverable", { email: state.email })}
          </Alert>
          {resent.status !== "idle" && (
            <Alert variant={resent.status === "done" ? "success" : "error"}>{resent.message}</Alert>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              size="md"
              isDisabled={resending}
              onPress={() => {
                startResend(async () => {
                  setResent(await resend(state.userId));
                });
              }}
            >
              {resending ? t("site.accounts.resend.working") : t("site.accounts.resend.act")}
            </Button>
            <Link className="qcms-text-link" href={accountHref(state.userId)}>
              {t("site.accounts.create.open", { name: state.name })}
            </Link>
          </div>
        </div>
      )}
      {state.status === "error" && <Alert variant="error">{state.message}</Alert>}

      <form
        key={state.status === "error" ? `${submitted.email}|${submitted.name}` : "fresh"}
        action={formAction}
        className="flex max-w-xl flex-col gap-4"
      >
        <TextField
          name="email"
          type="email"
          label={t("site.accounts.create.email")}
          defaultValue={submitted.email}
          autoComplete="off"
          isRequired
          maxLength={254}
        />
        <TextField
          name="name"
          label={t("site.accounts.create.name")}
          description={t("site.accounts.create.nameHint")}
          defaultValue={submitted.name}
          autoComplete="off"
          maxLength={120}
        />
        <p className="text-sm text-(--color-text-muted)">{t("site.accounts.create.note")}</p>
        <div>
          <Button type="submit" variant="primary" size="md" isDisabled={isPending || !isHydrated}>
            {isPending ? t("site.accounts.create.working") : t("site.accounts.create.act")}
          </Button>
        </div>
      </form>
    </div>
  );
}
