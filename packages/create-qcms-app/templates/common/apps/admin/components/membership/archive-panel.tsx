"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { HelpTip } from "@/components/help-tip";
import { Alert, Button, TextField } from "@/components/kit";
import { t, tPlural } from "@/lib/i18n/en";
import type { MembershipActionState } from "@/lib/membership/types";

/* The API refuses an archive that still has forms or the shared library; naming the blockers here
   only saves the operator the attempt. */
export function ArchivePanel({
  workspaceId,
  name,
  forms,
  isShared,
  archived,
  archive,
}: {
  readonly workspaceId: string;
  readonly name: string;
  /** Absent where the caller was sent no counts, which leaves the refusal to the API. */
  readonly forms: number | undefined;
  readonly isShared: boolean | undefined;
  readonly archived: boolean;
  readonly archive: (workspaceId: string) => Promise<MembershipActionState>;
}) {
  const [typed, setTyped] = useState("");
  const [state, setState] = useState<MembershipActionState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  const blockers: string[] = [];
  if (forms !== undefined && forms > 0) {
    blockers.push(
      tPlural("membership.archive.blocker.formsOne", "membership.archive.blocker.forms", forms),
    );
  }
  if (isShared === true) blockers.push(t("membership.archive.blocker.shared"));
  const done = state.status === "done";
  const matched = typed === name;

  return (
    <section aria-labelledby="qcms-archive-heading" className="flex min-w-0 flex-col gap-3">
      <div className="qcms-help-head">
        <h1 id="qcms-archive-heading" className="text-xl font-semibold text-(--color-text)">
          {t("membership.archive.heading")}
        </h1>
        <HelpTip>{t("membership.archive.intro")}</HelpTip>
      </div>

      {archived || done ? (
        <Alert variant={done ? "success" : "info"}>
          {done ? t("membership.archive.archived", { name }) : t("membership.archive.already")}
        </Alert>
      ) : (
        <>
          {state.status === "error" && <Alert variant="error">{state.message}</Alert>}

          {blockers.length > 0 && (
            <div
              className="flex min-w-0 flex-col gap-2 rounded-(--radius-card) border border-(--color-danger) px-4 py-3"
              data-testid="qcms-archive-blockers"
            >
              <p className="text-sm font-semibold text-(--color-danger-fg)">
                {t("membership.archive.blocked")}
              </p>
              <ul className="flex flex-col gap-1 text-sm">
                {blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
              <Link href="/forms" className="qcms-text-link text-sm">
                {t("membership.archive.openForms")}
              </Link>
            </div>
          )}

          <p className="text-sm">{t("membership.archive.cannotUndo", { name })}</p>

          <TextField
            label={t("access.confirm.typedLabel", { name })}
            description={t("membership.archive.typedHint")}
            value={typed}
            autoComplete="off"
            isDisabled={pending || blockers.length > 0}
            isInvalid={typed !== "" && !matched}
            errorMessage={t("access.confirm.typedMismatch", { name })}
            onChange={setTyped}
          />

          <div>
            <Button
              variant="danger"
              isDisabled={!matched || pending || blockers.length > 0}
              onPress={() => {
                startTransition(async () => {
                  setState(await archive(workspaceId));
                });
              }}
            >
              {pending ? t("membership.archive.working") : t("membership.archive.act", { name })}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
