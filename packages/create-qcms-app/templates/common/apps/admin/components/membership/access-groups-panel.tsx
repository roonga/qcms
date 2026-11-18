"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { ConfirmAct } from "@/components/access/confirm-act";
import { UncoveredNotice } from "@/components/access/uncovered-notice";
import { HeadingMarker } from "@/components/agent/heading-marker";
import { HelpTip } from "@/components/help-tip";
import { Alert, Button, Dialog } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { groupScope, roleName } from "@/lib/membership/access-group-form";
import { uncoveredScope, type AccessCapabilities } from "@/lib/membership/access-patterns";
import { draftOf, uncoveredAfterDelete, type GroupPayload } from "@/lib/membership/group-edit";
import { grantOf, offersReconfirm } from "@/lib/membership/people";
import type {
  AccessGroup,
  AccessGroupHolder,
  AccessGroupList,
  MembershipActionState,
} from "@/lib/membership/types";

import { GroupForm } from "./group-form";
import { NamedLabel } from "./named-label";
import { SuspendedTag } from "./suspended-tag";

export interface AccessGroupsActions {
  readonly update: (
    workspaceId: string,
    teamId: string,
    body: GroupPayload,
  ) => Promise<MembershipActionState>;
  readonly remove: (workspaceId: string, teamId: string) => Promise<MembershipActionState>;
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
}

type GroupAct =
  | { readonly kind: "delete" }
  | { readonly kind: "revoke"; readonly holder: AccessGroupHolder }
  | { readonly kind: "reconfirm"; readonly holder: AccessGroupHolder };

/** The workspace's groups, the "no group covers this" notice, and one group's sheet. */
export function AccessGroupsPanel({
  list,
  message,
  environments,
  viewerId,
  requireSecondApprover,
  capabilities,
  initialGroup,
  newHref,
  grantHref,
  names,
  actions,
}: {
  readonly list: AccessGroupList | undefined;
  readonly message: string | undefined;
  /** The installation's environments, in its own order. */
  readonly environments: readonly string[];
  readonly viewerId: string;
  readonly requireSecondApprover: boolean;
  readonly capabilities: AccessCapabilities;
  readonly initialGroup: string | undefined;
  readonly newHref: string;
  readonly grantHref: string;
  /** Each member's name by account id, for the people in a group. */
  readonly names: Readonly<Record<string, string>>;
  readonly actions: AccessGroupsActions;
}) {
  const [state, setState] = useState<MembershipActionState>({ status: "idle" });
  const [pending, startTransition] = useTransition();
  const [openId, setOpenId] = useState<string | undefined>(initialGroup);
  const [editing, setEditing] = useState(false);
  const [act, setAct] = useState<GroupAct | undefined>(undefined);
  const [actError, setActError] = useState<string | undefined>(undefined);

  const workspaceId = list?.workspaceId ?? "";
  const groups = list?.groups ?? [];
  const open = groups.find((group) => group.teamId === openId);

  function run(next: () => Promise<MembershipActionState>, after?: () => void): void {
    startTransition(async () => {
      const result = await next();
      if (result.status === "error") {
        setActError(result.message);
        return;
      }
      setActError(undefined);
      setAct(undefined);
      setEditing(false);
      after?.();
      setState(result);
    });
  }

  function person(holder: AccessGroupHolder): string {
    const name = names[holder.userId];
    return name === undefined || name === "" ? holder.email : name;
  }

  return (
    <section aria-labelledby="qcms-access-groups-heading" className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="qcms-help-head">
          <h1 id="qcms-access-groups-heading" className="text-xl font-semibold text-(--color-text)">
            {t("membership.groups.heading")}
          </h1>
          <HelpTip label={t("membership.groups.heading")}>{t("membership.groups.intro")}</HelpTip>
        </div>
        <HeadingMarker
          control={[
            "membership.groupCreate",
            "membership.groupRemove",
            "membership.grant",
            "membership.revoke",
          ]}
        >
          <Link href={newHref} className="qcms-button-link">
            {t("membership.groups.new")}
          </Link>
        </HeadingMarker>
      </div>

      {list === undefined && (
        <Alert variant="error">
          {t("membership.groups.loadFailed", { message: message ?? "" })}
        </Alert>
      )}
      <div aria-live="polite" className="flex min-w-0 flex-col gap-2">
        {state.status === "done" && <Alert variant="success">{state.message}</Alert>}
        {state.status === "held" && (
          <Alert variant="warning">
            <span className="qcms-tag qcms-tag--deprecated">
              {t("access.preview.needsApprover")}
            </span>{" "}
            {state.message}
          </Alert>
        )}
      </div>

      {list !== undefined && (
        <UncoveredNotice
          uncovered={uncoveredScope(groups.map(grantOf), environments)}
          capabilities={capabilities}
          addHref={newHref}
        />
      )}

      {list !== undefined &&
        (groups.length === 0 ? (
          <div className="flex min-w-0 flex-col items-start gap-1">
            <p className="text-sm font-semibold">{t("membership.groups.none")}</p>
            <p className="text-sm text-(--color-text-muted)">{t("membership.groups.noneHint")}</p>
          </div>
        ) : (
          <div className="qcms-table qcms-table--wide min-w-0">
            <table>
              <caption className="qcms-visually-hidden">{t("membership.groups.table")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("membership.groups.columnGroup")}</th>
                  <th scope="col">{t("membership.groups.columnRoles")}</th>
                  <th scope="col">{t("membership.groups.columnEnvironments")}</th>
                  <th scope="col">{t("membership.groups.columnHolders")}</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.teamId} data-group-name={group.name}>
                    <td>
                      <Button
                        variant="secondary"
                        size="md"
                        onPress={() => {
                          setState({ status: "idle" });
                          setActError(undefined);
                          setEditing(false);
                          setOpenId(group.teamId);
                        }}
                      >
                        <NamedLabel
                          visible={group.name}
                          name={t("membership.groups.open", { name: group.name })}
                        />
                      </Button>
                    </td>
                    <td>{group.roles.map(roleName).join(", ")}</td>
                    <td>
                      {group.environments.length === 0
                        ? t("membership.groups.everyEnvironment")
                        : group.environments.join(", ")}
                    </td>
                    <td>
                      {group.holders.length === 0 ? (
                        t("membership.groups.noHolders")
                      ) : (
                        <ul className="flex min-w-0 flex-col gap-1">
                          {group.holders.map((holder) => (
                            <li key={holder.userId}>
                              <span className="break-all">{holder.email}</span>{" "}
                              {holder.suspended && <SuspendedTag />}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {open !== undefined && act === undefined && (
        <Dialog
          isOpen
          title={editing ? t("membership.groups.editTitle", { name: open.name }) : open.name}
          isDismissable={!pending}
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              setEditing(false);
              setOpenId(undefined);
            }
          }}
        >
          {editing ? (
            <GroupForm
              initial={draftOf(open)}
              before={open}
              environments={environments}
              viewerInGroup={open.holders.some((holder) => holder.userId === viewerId)}
              requireSecondApprover={requireSecondApprover}
              submitLabel={t("membership.groups.save")}
              pending={pending}
              error={actError}
              onSubmit={(payload) => {
                run(() => actions.update(workspaceId, open.teamId, payload));
              }}
              onCancel={() => {
                setActError(undefined);
                setEditing(false);
              }}
            />
          ) : (
            <GroupSheet
              group={open}
              viewerId={viewerId}
              pending={pending}
              grantHref={`${grantHref}&group=${encodeURIComponent(open.teamId)}`}
              person={person}
              onEdit={() => {
                setActError(undefined);
                setEditing(true);
              }}
              onAct={(next) => {
                setActError(undefined);
                setAct(next);
              }}
            />
          )}
        </Dialog>
      )}

      {open !== undefined && act !== undefined && (
        <GroupConfirm
          group={open}
          groups={groups}
          environments={environments}
          act={act}
          person={person}
          pending={pending}
          error={actError}
          onCancel={() => {
            setActError(undefined);
            setAct(undefined);
          }}
          onConfirm={() => {
            if (act.kind === "delete") {
              run(
                () => actions.remove(workspaceId, open.teamId),
                () => {
                  setOpenId(undefined);
                },
              );
            } else if (act.kind === "revoke") {
              run(() => actions.revoke(workspaceId, open.teamId, act.holder.userId));
            } else {
              run(() =>
                actions.reconfirm(workspaceId, open.teamId, act.holder.userId, person(act.holder)),
              );
            }
          }}
        />
      )}
    </section>
  );
}

function GroupSheet({
  group,
  viewerId,
  pending,
  grantHref,
  person,
  onEdit,
  onAct,
}: {
  readonly group: AccessGroup;
  readonly viewerId: string;
  readonly pending: boolean;
  readonly grantHref: string;
  readonly person: (holder: AccessGroupHolder) => string;
  readonly onEdit: () => void;
  readonly onAct: (act: GroupAct) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="qcms-group-sheet">
      <p className="text-sm text-(--color-text-muted)">{groupScope(group)}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="md" isDisabled={pending} onPress={onEdit}>
          {t("membership.groups.change")}
        </Button>
        <Link href={grantHref} className="qcms-button-link qcms-button-link--secondary">
          {t("membership.groups.addPerson")}
        </Link>
        <Button
          variant="danger"
          size="md"
          isDisabled={pending}
          onPress={() => {
            onAct({ kind: "delete" });
          }}
        >
          {t("membership.groups.delete")}
        </Button>
      </div>
      <section aria-labelledby="qcms-group-people" className="flex min-w-0 flex-col gap-2">
        <h3 id="qcms-group-people" className="text-sm font-semibold">
          {t("membership.groups.columnHolders")}
        </h3>
        {group.holders.length === 0 ? (
          <p className="text-sm text-(--color-text-muted)">{t("membership.groups.noHolders")}</p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-2">
            {group.holders.map((holder) => (
              <li
                key={holder.userId}
                className="flex min-w-0 flex-wrap items-center gap-2 border-t border-(--color-border) pt-2"
                data-holder={holder.email}
              >
                <span className="min-w-0 flex-1 text-sm break-all">
                  {person(holder)} {holder.suspended && <SuspendedTag />}
                  {holder.suspended && !offersReconfirm(viewerId, holder.userId, true) && (
                    <span className="block text-xs text-(--color-text-muted)">
                      {t("membership.person.reconfirmOwn")}
                    </span>
                  )}
                </span>
                {offersReconfirm(viewerId, holder.userId, holder.suspended) && (
                  <Button
                    size="md"
                    isDisabled={pending}
                    onPress={() => {
                      onAct({ kind: "reconfirm", holder });
                    }}
                  >
                    <NamedLabel
                      visible={t("membership.person.reconfirm")}
                      name={t("membership.person.reconfirmFor", {
                        person: person(holder),
                        group: group.name,
                      })}
                    />
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="md"
                  isDisabled={pending}
                  onPress={() => {
                    onAct({ kind: "revoke", holder });
                  }}
                >
                  <NamedLabel
                    visible={t("membership.groups.removeHolder")}
                    name={t("membership.groups.removeHolderFor", { email: holder.email })}
                  />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function GroupConfirm({
  group,
  groups,
  environments,
  act,
  person,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  readonly group: AccessGroup;
  readonly groups: readonly AccessGroup[];
  readonly environments: readonly string[];
  readonly act: GroupAct;
  readonly person: (holder: AccessGroupHolder) => string;
  readonly pending: boolean;
  readonly error: string | undefined;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const common = { pending, error, onCancel, onConfirm, level: { kind: "plain" } as const };
  if (act.kind === "delete") {
    const left = uncoveredAfterDelete(groups, group.teamId, environments);
    const lines = [
      ...left.roles.map((role) =>
        t("membership.groups.deleteUncoveredRole", { role: roleName(role) }),
      ),
      ...left.environments.map((environment) =>
        t("membership.groups.deleteUncoveredEnvironment", { environment }),
      ),
    ];
    return (
      <ConfirmAct
        {...common}
        tone="danger"
        title={t("membership.groups.deleteTitle", { name: group.name })}
        act={t("membership.groups.deleteAct", { name: group.name })}
        preview={
          <div className="flex flex-col gap-2 text-sm" data-testid="qcms-group-delete-preview">
            <p>
              {group.holders.length === 0
                ? t("membership.groups.deleteEmpty")
                : t("membership.groups.deletePeople", { count: String(group.holders.length) })}
            </p>
            {lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        }
      />
    );
  }
  const name = person(act.holder);
  return act.kind === "revoke" ? (
    <ConfirmAct
      {...common}
      tone="danger"
      title={t("membership.person.revokeTitle", { group: group.name, person: name })}
      act={t("membership.person.revokeAct", { group: group.name })}
    />
  ) : (
    <ConfirmAct
      {...common}
      title={t("membership.person.reconfirmTitle", { group: group.name, person: name })}
      act={t("membership.person.reconfirm")}
    />
  );
}
