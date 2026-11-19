"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { AccessPreview } from "@/components/access/access-preview";
import { ConfirmAct } from "@/components/access/confirm-act";
import { HeadingMarker } from "@/components/agent/heading-marker";
import { HelpTip } from "@/components/help-tip";
import { Alert, Button } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { accessDelta, type AccessCapabilities } from "@/lib/membership/access-patterns";
import { grantOf, liveGrants, type PersonRow } from "@/lib/membership/people";
import { workspaceSectionHref } from "@/lib/membership/sections";
import type { MembershipActionState } from "@/lib/membership/types";

import { PersonSheet, type PersonAct } from "./person-sheet";
import { NamedLabel } from "./named-label";
import { SuspendedTag } from "./suspended-tag";

export interface MembersActions {
  readonly setRole: (
    workspaceId: string,
    userId: string,
    role: "forms.owner" | "member",
  ) => Promise<MembershipActionState>;
  readonly revoke: (
    workspaceId: string,
    teamId: string,
    userId: string,
  ) => Promise<MembershipActionState>;
  readonly reconfirm: (
    workspaceId: string,
    teamId: string,
    userId: string,
    person: string,
  ) => Promise<MembershipActionState>;
  readonly removeMember: (
    workspaceId: string,
    userId: string,
    person: string,
  ) => Promise<MembershipActionState>;
}

function labelOf(person: PersonRow): string {
  return person.name === "" ? person.email : person.name;
}

/** The workspace's people; a row opens its side sheet, and every act there is confirmed first. */
export function MembersPanel({
  workspaceId,
  workspaceName,
  viewerId,
  people,
  lastAdministrators,
  environments,
  capabilities,
  filtered,
  message,
  grantHref,
  groupsHref,
  actions,
}: {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly viewerId: string;
  /** This page's rows, already filtered; `undefined` when the list could not be read. */
  readonly people: readonly PersonRow[] | undefined;
  readonly lastAdministrators: readonly string[];
  readonly environments: readonly string[];
  readonly capabilities: AccessCapabilities;
  readonly filtered: boolean;
  readonly message: string | undefined;
  readonly grantHref: string;
  readonly groupsHref: string;
  readonly actions: MembersActions;
}) {
  const [state, setState] = useState<MembershipActionState>({ status: "idle" });
  const [pending, startTransition] = useTransition();
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const [act, setAct] = useState<PersonAct | undefined>(undefined);
  const [actError, setActError] = useState<string | undefined>(undefined);

  const open = people?.find((person) => person.userId === openId);

  function run(next: () => Promise<MembershipActionState>, closeSheet = false): void {
    startTransition(async () => {
      const result = await next();
      if (result.status === "error") {
        setActError(result.message);
        return;
      }
      setActError(undefined);
      setAct(undefined);
      if (closeSheet) setOpenId(undefined);
      setState(result);
    });
  }

  return (
    <section aria-labelledby="qcms-members-heading" className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="qcms-help-head">
          <h1 id="qcms-members-heading" className="text-xl font-semibold text-(--color-text)">
            {t("membership.members.heading")}
          </h1>
          <HelpTip>{t("membership.members.intro")}</HelpTip>
        </div>
        <Link href={grantHref} className="qcms-button-link">
          {t("membership.grant.heading")}
        </Link>
      </div>

      {people === undefined && (
        <Alert variant="error">
          {t("membership.members.loadFailed", { message: message ?? "" })}
        </Alert>
      )}
      <div aria-live="polite" className="flex min-w-0 flex-col gap-2">
        {state.status === "done" && <Alert variant="success">{state.message}</Alert>}
        {state.status === "held" && <Alert variant="warning">{state.message}</Alert>}
      </div>

      {people !== undefined &&
        (people.length === 0 ? (
          <div className="flex min-w-0 flex-col items-start gap-2" data-testid="qcms-members-empty">
            <p className="text-sm font-semibold">
              {filtered ? t("membership.members.noMatch") : t("membership.members.none")}
            </p>
            {!filtered && (
              <p className="text-sm text-(--color-text-muted)">
                {t("membership.members.noneHint")}
              </p>
            )}
          </div>
        ) : (
          <HeadingMarker control="membership.memberRole" block>
            <div className="qcms-table qcms-table--wide min-w-0">
              <table>
                <caption className="qcms-visually-hidden">{t("membership.members.table")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("membership.members.columnPerson")}</th>
                    <th scope="col">{t("membership.members.columnAdministrator")}</th>
                    <th scope="col">{t("membership.members.columnGroups")}</th>
                    <th scope="col">{t("membership.members.columnStatus")}</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((person) => (
                    <tr key={person.userId} data-person={person.email}>
                      <td>
                        <Button
                          variant="secondary"
                          size="md"
                          onPress={() => {
                            setState({ status: "idle" });
                            setActError(undefined);
                            setOpenId(person.userId);
                          }}
                        >
                          <NamedLabel
                            visible={labelOf(person)}
                            name={t("membership.members.open", { person: labelOf(person) })}
                          />
                        </Button>
                        <span className="block text-xs break-all text-(--color-text-muted)">
                          {person.email}
                        </span>
                      </td>
                      <td>
                        {person.administrator
                          ? t("membership.members.administratorYes")
                          : t("membership.members.administratorNo")}
                      </td>
                      <td>
                        {person.holds.length === 0 ? (
                          t("membership.members.noGroups")
                        ) : (
                          <ul className="flex min-w-0 flex-col gap-1">
                            {person.holds.map((hold) => (
                              <li key={hold.group.teamId}>
                                {hold.group.name} {hold.suspended && <SuspendedTag />}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td>{t(`access.status.${person.status}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </HeadingMarker>
        ))}

      {open !== undefined && act === undefined && (
        <PersonSheet
          person={open}
          workspaceName={workspaceName}
          viewerId={viewerId}
          environments={environments}
          capabilities={capabilities}
          isLast={lastAdministrators.includes(open.userId)}
          grantHref={`${grantHref}&email=${encodeURIComponent(open.email)}`}
          groupHref={(teamId) => `${groupsHref}?group=${encodeURIComponent(teamId)}`}
          appointHref={workspaceSectionHref(workspaceId, "members")}
          pending={pending}
          onAct={(next) => {
            setActError(undefined);
            setAct(next);
          }}
          onClose={() => {
            setOpenId(undefined);
          }}
        />
      )}

      {open !== undefined && act !== undefined && (
        <PersonConfirm
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          person={open}
          act={act}
          environments={environments}
          pending={pending}
          error={actError}
          actions={actions}
          run={run}
          onCancel={() => {
            setActError(undefined);
            setAct(undefined);
          }}
        />
      )}
    </section>
  );
}

function PersonConfirm({
  workspaceId,
  workspaceName,
  person,
  act,
  environments,
  pending,
  error,
  actions,
  run,
  onCancel,
}: {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly person: PersonRow;
  readonly act: PersonAct;
  readonly environments: readonly string[];
  readonly pending: boolean;
  readonly error: string | undefined;
  readonly actions: MembersActions;
  readonly run: (next: () => Promise<MembershipActionState>, closeSheet?: boolean) => void;
  readonly onCancel: () => void;
}) {
  const label = labelOf(person);
  const common = { pending, error, onCancel, level: { kind: "plain" } as const };
  const losing = (kept: readonly ReturnType<typeof grantOf>[]) => (
    <AccessPreview delta={accessDelta(liveGrants(person), kept, environments)} />
  );

  switch (act.kind) {
    case "appoint":
      return (
        <ConfirmAct
          {...common}
          title={t("membership.person.appointTitle", { person: label })}
          act={t("membership.person.appointAct", { person: label })}
          preview={<p className="text-sm">{t("membership.person.appointBody")}</p>}
          onConfirm={() => {
            run(() => actions.setRole(workspaceId, person.userId, "forms.owner"));
          }}
        />
      );
    case "removeAdministrator":
      return (
        <ConfirmAct
          {...common}
          tone="danger"
          title={t("membership.person.removeAdminTitle", { person: label })}
          act={t("access.lastAdmin.remove")}
          preview={<p className="text-sm">{t("membership.person.removeAdminBody")}</p>}
          onConfirm={() => {
            run(() => actions.setRole(workspaceId, person.userId, "member"));
          }}
        />
      );
    case "revoke":
      return (
        <ConfirmAct
          {...common}
          tone="danger"
          title={t("membership.person.revokeTitle", { group: act.hold.group.name, person: label })}
          act={t("membership.person.revokeAct", { group: act.hold.group.name })}
          preview={losing(liveGrants(person).filter((grant) => grant.id !== act.hold.group.teamId))}
          onConfirm={() => {
            run(() => actions.revoke(workspaceId, act.hold.group.teamId, person.userId));
          }}
        />
      );
    case "reconfirm":
      return (
        <ConfirmAct
          {...common}
          title={t("membership.person.reconfirmTitle", {
            group: act.hold.group.name,
            person: label,
          })}
          act={t("membership.person.reconfirm")}
          preview={
            <AccessPreview
              delta={accessDelta(
                liveGrants(person),
                [...liveGrants(person), grantOf(act.hold.group)],
                environments,
              )}
            />
          }
          onConfirm={() => {
            run(() => actions.reconfirm(workspaceId, act.hold.group.teamId, person.userId, label));
          }}
        />
      );
    case "removeFromWorkspace":
      return (
        <ConfirmAct
          {...common}
          tone="danger"
          title={t("membership.person.removeTitle", { person: label, workspace: workspaceName })}
          act={t("membership.person.removeAct", { person: label })}
          preview={
            <div className="flex flex-col gap-2">
              {losing([])}
              {person.administrator && (
                <p className="text-sm">{t("membership.person.adminLoses")}</p>
              )}
            </div>
          }
          onConfirm={() => {
            run(() => actions.removeMember(workspaceId, person.userId, label), true);
          }}
        />
      );
  }
}
