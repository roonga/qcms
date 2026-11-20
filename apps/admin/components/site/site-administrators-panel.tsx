"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Alert, Button, TextField } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { accountHref, type Account } from "@/lib/site/accounts";
import {
  IDLE_ROLE_ACT,
  PROMOTE_SEARCH_MAX_LENGTH,
  roleApprovalText,
  roleBlockText,
  type RoleAct,
  type RoleActState,
  type RoleControl,
} from "@/lib/site/administrators";

import { StepUpDialog, type StepUpCredentials } from "./step-up-dialog";

export interface RoleRow {
  readonly account: Account;
  readonly control: RoleControl;
}

type RoleActCall = (userId: string, credentials: StepUpCredentials) => Promise<RoleActState>;

/** A promote or demote button, disabled with its reason where the act is refused here. */
function RoleButton({
  row,
  act,
  onOpen,
}: {
  readonly row: RoleRow;
  readonly act: RoleAct;
  readonly onOpen: () => void;
}) {
  const blocked = row.control.blocked;
  const label =
    act === "promote" ? t("site.administrators.promote.act") : t("site.administrators.demote.act");
  return (
    <div className="flex min-w-0 max-w-sm flex-col items-start gap-1" data-role-act={act}>
      <Button
        variant={act === "promote" ? "primary" : "secondary"}
        size="md"
        isDisabled={blocked !== undefined}
        onPress={onOpen}
      >
        <span aria-hidden="true">{label}</span>
        <span className="qcms-visually-hidden">
          {t(
            act === "promote"
              ? "site.administrators.promote.confirm"
              : "site.administrators.demote.confirm",
            { person: row.account.name },
          )}
        </span>
      </Button>
      {blocked !== undefined && (
        <p className="text-sm text-(--color-text-muted)">
          {roleBlockText(blocked, row.account.name)}
        </p>
      )}
    </div>
  );
}

/* The API refuses every act a control here hides or disables; these are courtesies, not the check. */
export function SiteAdministratorsPanel({
  administrators,
  candidates,
  search,
  promote,
  demote,
}: {
  readonly administrators: readonly RoleRow[];
  /** `undefined` before a search, so the screen offers no account it was not asked for. */
  readonly candidates: readonly RoleRow[] | undefined;
  readonly search: string;
  readonly promote: RoleActCall;
  readonly demote: RoleActCall;
}) {
  const [open, setOpen] = useState<{ readonly act: RoleAct; readonly row: RoleRow } | undefined>();
  const [outcome, setOutcome] = useState<RoleActState>(IDLE_ROLE_ACT);
  const [failure, setFailure] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  const begin = (act: RoleAct, row: RoleRow) => {
    setOutcome(IDLE_ROLE_ACT);
    setFailure(undefined);
    setOpen({ act, row });
  };
  const close = () => {
    setOpen(undefined);
    setFailure(undefined);
  };
  const confirm = (credentials: StepUpCredentials) => {
    if (open === undefined) return;
    const call = open.act === "promote" ? promote : demote;
    const userId = open.row.account.userId;
    startTransition(async () => {
      const result = await call(userId, credentials);
      if (result.status === "error") {
        setFailure(result.message);
        return;
      }
      close();
      setOutcome(result);
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="qcms-site-administrators">
      {outcome.status === "done" && <Alert variant="success">{outcome.message}</Alert>}
      {outcome.status === "held" && <Alert variant="info">{outcome.message}</Alert>}

      <div className="qcms-table">
        <table data-testid="qcms-site-administrators-table">
          <caption className="qcms-visually-hidden">{t("site.administrators.table")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("site.accounts.column.name")}</th>
              <th scope="col">{t("site.accounts.column.email")}</th>
              <th scope="col">{t("site.administrators.column.act")}</th>
            </tr>
          </thead>
          <tbody>
            {administrators.map((row) => (
              <tr key={row.account.userId} data-account={row.account.userId}>
                <th scope="row">
                  <Link className="qcms-text-link" href={accountHref(row.account.userId)}>
                    {row.account.name}
                  </Link>
                </th>
                <td>{row.account.email}</td>
                <td>
                  <RoleButton row={row} act="demote" onOpen={() => begin("demote", row)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section aria-labelledby="qcms-promote-heading" className="flex min-w-0 flex-col gap-3">
        <h2 id="qcms-promote-heading" className="text-lg font-semibold text-(--color-text)">
          {t("site.administrators.promote.heading")}
        </h2>
        <p className="text-sm text-(--color-text-muted)">{t("site.administrators.promote.intro")}</p>
        <form
          method="get"
          role="search"
          aria-label={t("site.administrators.promote.search")}
          className="flex flex-wrap items-end gap-3"
        >
          <TextField
            name="q"
            type="text"
            label={t("site.administrators.promote.search")}
            description={t("site.administrators.promote.searchHint")}
            defaultValue={search}
            maxLength={PROMOTE_SEARCH_MAX_LENGTH}
          />
          <Button type="submit" variant="secondary" size="md">
            {t("site.administrators.promote.find")}
          </Button>
        </form>
        {candidates !== undefined && candidates.length === 0 && (
          <p className="text-sm text-(--color-text-muted)" data-testid="qcms-promote-none">
            {t("site.administrators.promote.none")}
          </p>
        )}
        {candidates !== undefined && candidates.length > 0 && (
          <div className="qcms-table">
            <table data-testid="qcms-promote-candidates">
              <caption className="qcms-visually-hidden">
                {t("site.administrators.promote.table")}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t("site.accounts.column.name")}</th>
                  <th scope="col">{t("site.accounts.column.email")}</th>
                  <th scope="col">{t("site.administrators.column.act")}</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((row) => (
                  <tr key={row.account.userId} data-account={row.account.userId}>
                    <th scope="row">{row.account.name}</th>
                    <td>{row.account.email}</td>
                    <td>
                      <RoleButton row={row} act="promote" onOpen={() => begin("promote", row)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {open !== undefined && (
        <StepUpDialog
          title={t(
            open.act === "promote"
              ? "site.administrators.promote.title"
              : "site.administrators.demote.title",
            { person: open.row.account.name },
          )}
          act={t(
            open.act === "promote"
              ? "site.administrators.promote.confirm"
              : "site.administrators.demote.confirm",
            { person: open.row.account.name },
          )}
          tone={open.act === "demote" ? "danger" : "primary"}
          approvalText={roleApprovalText(open.row.control.approval)}
          pending={pending}
          error={failure}
          onConfirm={confirm}
          onCancel={close}
        >
          <p className="text-sm">
            {t(
              open.act === "promote"
                ? "site.administrators.promote.body"
                : "site.administrators.demote.body",
              { person: open.row.account.name },
            )}
          </p>
        </StepUpDialog>
      )}
    </div>
  );
}
