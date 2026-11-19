"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { HeadingMarker } from "@/components/agent/heading-marker";
import { HelpTip } from "@/components/help-tip";
import { Alert, Button, Checkbox, TextField } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import {
  askedSentence,
  expiryWording,
  personLabel,
  type HeldRequest,
} from "@/lib/membership/approval-wording";
import { workspaceSectionHref } from "@/lib/membership/sections";
import type { MembershipActionState, WorkspaceSettings } from "@/lib/membership/types";

/* The API refuses a turn-on nobody could approve and holds a switch-off for an Approver; the states
   here report its answer and never stand in for it. */
export function WorkspaceSettingsPanel({
  settings,
  workspace,
  viewerId,
  people,
  held,
  decided,
  rename,
  save,
  decide,
}: {
  readonly settings: WorkspaceSettings;
  readonly workspace: { readonly name: string; readonly slug: string };
  readonly viewerId: string;
  readonly people: ReadonlyMap<string, string>;
  /** A switch-off waiting for an Approver, which is why the switch takes no further change. */
  readonly held: HeldRequest | undefined;
  /** How the last switch-off ended, shown only while none is waiting. */
  readonly decided: HeldRequest | undefined;
  readonly rename: (workspaceId: string, name: string) => Promise<MembershipActionState>;
  readonly save: (
    workspaceId: string,
    next: { readonly requireSecondApprover: boolean },
  ) => Promise<MembershipActionState>;
  readonly decide: (
    workspaceId: string,
    requestId: string,
    decision: "approve" | "reject",
  ) => Promise<MembershipActionState>;
}) {
  const [name, setName] = useState(workspace.name);
  const [renameState, setRenameState] = useState<MembershipActionState>({ status: "idle" });
  const [twoPerson, setTwoPerson] = useState(settings.requireSecondApprover);
  const [state, setState] = useState<MembershipActionState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  const { workspaceId } = settings;
  const on = settings.requireSecondApprover;
  const refusedTurnOn = !on && settings.nobodyElseCouldApprove;
  const ownHold = held !== undefined && held.request.requestedBy === viewerId;
  const empty = name.trim() === "";

  return (
    <section
      aria-labelledby="qcms-workspace-settings-heading"
      className="flex min-w-0 flex-col gap-6"
    >
      <h1
        id="qcms-workspace-settings-heading"
        className="text-xl font-semibold text-(--color-text)"
      >
        {t("membership.settings.heading")}
      </h1>

      <div className="flex min-w-0 flex-col gap-3">
        {renameState.status === "error" && <Alert variant="error">{renameState.message}</Alert>}
        {renameState.status === "done" && <Alert variant="success">{renameState.message}</Alert>}

        <TextField
          label={t("membership.settings.name")}
          value={name}
          isDisabled={pending}
          isInvalid={renameState.status === "error" && empty}
          errorMessage={t("membership.settings.nameEmpty")}
          onChange={setName}
        />
        <p className="text-xs text-(--color-text-muted)">
          {t("membership.settings.identifier", { slug: workspace.slug })}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            isDisabled={pending}
            onPress={() => {
              if (empty) {
                setRenameState({ status: "error", message: t("membership.settings.nameEmpty") });
                return;
              }
              startTransition(async () => {
                setRenameState(await rename(workspaceId, name.trim()));
              });
            }}
          >
            {t("membership.settings.nameSave")}
          </Button>
          <Button
            variant="secondary"
            isDisabled={pending || name === workspace.name}
            onPress={() => {
              setName(workspace.name);
              setRenameState({ status: "idle" });
            }}
          >
            {t("membership.settings.nameDiscard")}
          </Button>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="qcms-help-head">
          <h2 className="text-lg font-semibold text-(--color-text)">
            {t("membership.settings.secondApproval")}
          </h2>
          <HelpTip>{t("membership.settings.twoPersonHelp")}</HelpTip>
        </div>

        {state.status === "error" && <Alert variant="error">{state.message}</Alert>}
        {state.status === "done" && <Alert variant="success">{state.message}</Alert>}

        {on && settings.nobodyElseCouldApprove && (
          <Alert variant="warning">
            <span data-testid="qcms-second-approval-warning">
              {t("membership.settings.warning")}
            </span>{" "}
            {settings.missingApprover.administrator && (
              <>
                {t("membership.settings.cause.administrator")}{" "}
                <Link
                  className="qcms-text-link"
                  href={workspaceSectionHref(workspaceId, "members")}
                >
                  {t("membership.settings.warning.addAdministrator")}
                </Link>
              </>
            )}
            {settings.missingApprover.publisher && (
              <>
                {" "}
                {t("membership.settings.cause.publisher")}{" "}
                <Link
                  className="qcms-text-link"
                  href={workspaceSectionHref(workspaceId, "access-groups")}
                >
                  {t("membership.settings.warning.addPublisher")}
                </Link>
              </>
            )}
          </Alert>
        )}

        <HeadingMarker control="membership.workspaceSettings" block>
          <div className="flex flex-col gap-2">
            <Checkbox
              label={t("membership.settings.twoPerson")}
              isSelected={twoPerson}
              isDisabled={pending || refusedTurnOn || held !== undefined}
              onChange={setTwoPerson}
            />
            <p id="qcms-two-person-help" className="text-xs text-(--color-text-muted)">
              {t("membership.settings.twoPersonHelp")}
            </p>
          </div>
        </HeadingMarker>

        {refusedTurnOn && (
          <div
            className="flex flex-col gap-1 text-sm text-(--color-danger-fg)"
            data-testid="qcms-second-approval-refusal"
          >
            <p>{t("membership.settings.cannotTurnOn")}</p>
            {settings.missingApprover.administrator && (
              <p>{t("membership.settings.cause.administrator")}</p>
            )}
            {settings.missingApprover.publisher && (
              <p>{t("membership.settings.cause.publisher")}</p>
            )}
            <p className="text-(--color-text-muted)">{t("membership.settings.cause.note")}</p>
          </div>
        )}

        {held !== undefined && (
          <div
            className="flex min-w-0 flex-col gap-2 rounded-(--radius-card) border border-(--color-border) px-4 py-3"
            data-testid="qcms-second-approval-held"
          >
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span className="qcms-tag qcms-tag--deprecated">
                {t("membership.requests.waiting")}
              </span>
              {expiryWording(held.expiresInDays)}
            </p>
            <p className="text-sm">{t("membership.settings.held")}</p>
            {ownHold ? (
              <p className="text-sm text-(--color-text-muted)">
                {t("membership.settings.heldOwn")}
              </p>
            ) : (
              <>
                <p className="text-sm">
                  {askedSentence(held.request, personLabel(held.request.requestedBy, people))}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    isDisabled={pending}
                    onPress={() => {
                      startTransition(async () => {
                        setState(await decide(workspaceId, held.request.requestId, "approve"));
                      });
                    }}
                  >
                    {t("membership.requests.approve")}
                  </Button>
                  <Button
                    variant="secondary"
                    isDisabled={pending}
                    onPress={() => {
                      startTransition(async () => {
                        setState(await decide(workspaceId, held.request.requestId, "reject"));
                      });
                    }}
                  >
                    {t("membership.requests.reject")}
                  </Button>
                </div>
              </>
            )}
            <Link
              className="qcms-text-link text-sm"
              href={workspaceSectionHref(workspaceId, "audit")}
            >
              {t("membership.settings.requestsLink")}
            </Link>
          </div>
        )}

        {held === undefined && decided !== undefined && (
          <p
            className="text-sm text-(--color-text-muted)"
            data-testid="qcms-second-approval-decided"
          >
            {decidedOutcome(decided, people)}
          </p>
        )}

        <div>
          <Button
            isDisabled={pending || held !== undefined || twoPerson === on}
            onPress={() => {
              startTransition(async () => {
                setState(await save(workspaceId, { requireSecondApprover: twoPerson }));
              });
            }}
          >
            {t("membership.settings.save")}
          </Button>
        </div>
      </div>
    </section>
  );
}

function decidedOutcome(decided: HeldRequest, people: ReadonlyMap<string, string>): string {
  const person = personLabel(decided.request.decidedBy, people);
  const status = decided.request.status;
  if (status === "approved") return t("membership.settings.decided.approved", { person });
  if (status === "rejected") return t("membership.settings.decided.rejected", { person });
  if (status === "lapsed") return t("membership.settings.decided.lapsed");
  return t("membership.settings.decided.expired");
}
