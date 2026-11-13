"use client";

import { useState, useTransition } from "react";

import { FieldHelp, HelpTip } from "@/components/help-tip";
import { Alert, Button, Checkbox, Select, TextField } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { HeadingMarker } from "@/components/agent/heading-marker";
import {
  GROUP_ROLES,
  grantCandidates,
  groupScope,
  needsEnvironments,
  roleDescription,
  roleName,
  setOf,
  toggleOne,
  type GrantCandidate,
} from "@/lib/membership/access-group-form";
import type { AccessGroupList, MembershipActionState } from "@/lib/membership/types";

/* Group names are labels, never authorization inputs or join keys; grants come from the roles, the
   environment set, and membership. */
export function AccessGroupsPanel({
  list,
  message,
  environments,
  members,
  create,
  remove,
  grant,
  revoke,
}: {
  readonly list: AccessGroupList | undefined;
  readonly message: string | undefined;
  /** The installation's environments, in its own order. */
  readonly environments: readonly string[];
  readonly members: readonly GrantCandidate[];
  readonly create: (
    workspaceId: string,
    body: {
      readonly name: string;
      readonly roles: readonly string[];
      readonly environments: readonly string[];
    },
  ) => Promise<MembershipActionState>;
  readonly remove: (workspaceId: string, teamId: string) => Promise<MembershipActionState>;
  readonly grant: (
    workspaceId: string,
    teamId: string,
    email: string,
  ) => Promise<MembershipActionState>;
  readonly revoke: (
    workspaceId: string,
    teamId: string,
    userId: string,
  ) => Promise<MembershipActionState>;
}) {
  const [state, setState] = useState<MembershipActionState>({ status: "idle" });
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [role, setRole] = useState<string>(GROUP_ROLES[0]);
  const [chosenEnvironments, setChosenEnvironments] = useState<readonly string[]>([]);
  const [holder, setHolder] = useState<Readonly<Record<string, string>>>({});

  const workspaceId = list?.workspaceId ?? "";
  // One role per group until the Access groups screen is rebuilt; the API already takes a set.
  const roles = [role];
  const wantsEnvironments = needsEnvironments(roles);
  const environmentSet = wantsEnvironments ? setOf(chosenEnvironments, environments) : [];
  const description = roleDescription(role);
  const incomplete = name.trim() === "" || (wantsEnvironments && environmentSet.length === 0);

  function run(action: () => Promise<MembershipActionState>): void {
    startTransition(async () => {
      setState(await action());
    });
  }

  return (
    <section aria-labelledby="qcms-access-groups-heading" className="flex min-w-0 flex-col gap-4">
      <div className="qcms-help-head">
        <h1 id="qcms-access-groups-heading" className="text-xl font-semibold text-(--color-text)">
          {t("membership.groups.heading")}
        </h1>
        <HelpTip label={t("membership.groups.heading")}>{t("membership.groups.intro")}</HelpTip>
      </div>

      {list === undefined && (
        <Alert variant="error">
          {t("membership.groups.loadFailed", { message: message ?? "" })}
        </Alert>
      )}
      {state.status === "error" && <Alert variant="error">{state.message}</Alert>}
      {state.status === "done" && <Alert variant="success">{state.message}</Alert>}

      {list !== undefined &&
        (list.groups.length === 0 ? (
          <p className="text-sm text-(--color-text-muted)">{t("membership.groups.none")}</p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-4">
            {list.groups.map((group) => {
              const candidates = grantCandidates(members, group.holders);
              const chosen = holder[group.teamId] ?? null;
              return (
                <li
                  key={group.teamId}
                  className="flex min-w-0 flex-col gap-2 border-t pt-2"
                  data-group-name={group.name}
                >
                  <p className="text-sm font-medium text-(--color-text)">{group.name}</p>
                  <p className="text-xs text-(--color-text-muted)">{groupScope(group)}</p>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs break-all text-(--color-text-muted)">
                    <dt>{t("membership.groups.columnRoles")}</dt>
                    <dd>{group.roles.map(roleName).join(", ")}</dd>
                    <dt>{t("membership.groups.columnEnvironments")}</dt>
                    <dd>
                      {group.environments.length === 0
                        ? t("membership.groups.everyEnvironment")
                        : group.environments.join(", ")}
                    </dd>
                    <dt>{t("membership.groups.columnHolders")}</dt>
                    <dd>
                      {group.holders.length === 0
                        ? t("membership.groups.noHolders")
                        : String(group.holders.length)}
                    </dd>
                  </dl>

                  <div className="flex min-w-0 flex-wrap items-end gap-2">
                    {candidates.length === 0 ? (
                      <p className="text-xs text-(--color-text-muted)">
                        {t("membership.groups.addHolderNone")}
                      </p>
                    ) : (
                      <>
                        <Select
                          label={t("membership.groups.addHolderMember")}
                          placeholder={t("membership.groups.addHolderChoose")}
                          value={chosen}
                          onChange={(value: string) => {
                            setHolder((current) => ({ ...current, [group.teamId]: value }));
                          }}
                          items={candidates.map((member) => ({
                            label: member.email,
                            value: member.email,
                          }))}
                        />
                        <Button
                          isDisabled={pending || chosen === null}
                          onPress={() => {
                            if (chosen === null) return;
                            run(() => grant(workspaceId, group.teamId, chosen));
                          }}
                        >
                          {t("membership.groups.addHolderSubmit")}
                        </Button>
                      </>
                    )}
                    <Button
                      variant="secondary"
                      isDisabled={pending}
                      onPress={() => {
                        run(() => remove(workspaceId, group.teamId));
                      }}
                    >
                      {t("membership.groups.remove")}
                    </Button>
                  </div>

                  {group.holders.length > 0 && (
                    <ul className="flex min-w-0 flex-col gap-1">
                      {group.holders.map((entry) => (
                        <li
                          key={entry.userId}
                          className="flex min-w-0 flex-wrap items-center gap-2"
                        >
                          <span className="min-w-0 text-xs break-all text-(--color-text-muted)">
                            {entry.email}
                          </span>
                          {/* Keep holder identity in the accessible name without widening the visible Revoke control past the mobile
   viewport. */}
                          <Button
                            variant="secondary"
                            isDisabled={pending}
                            aria-label={t("membership.groups.removeHolderFor", {
                              email: entry.email,
                            })}
                            onPress={() => {
                              run(() => revoke(workspaceId, group.teamId, entry.userId));
                            }}
                          >
                            {t("membership.groups.removeHolder")}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        ))}

      <div
        className="flex min-w-0 flex-col gap-3 border-t pt-4"
        data-testid="qcms-access-group-create"
      >
        <h2 className="text-sm font-semibold text-(--color-text)">
          {t("membership.groups.create")}
        </h2>
        <HeadingMarker
          control={[
            "membership.groupCreate",
            "membership.groupRemove",
            "membership.grant",
            "membership.revoke",
          ]}
          block
        >
          <TextField label={t("membership.groups.createName")} value={name} onChange={setName} />
        </HeadingMarker>

        <Select
          label={t("membership.groups.createRole")}
          value={role}
          onChange={setRole}
          items={GROUP_ROLES.map((entry) => ({ label: roleName(entry), value: entry }))}
          {...(description === undefined ? {} : { description })}
        />

        {wantsEnvironments ? (
          <fieldset className="flex min-w-0 flex-col gap-1">
            <legend className="text-sm font-medium text-(--color-text)">
              {t("membership.groups.createEnvironments")}
            </legend>
            <FieldHelp help={t("membership.groups.environmentsHelp")}>
              <div className="flex flex-col gap-1">
                {environments.map((environment) => (
                  <Checkbox
                    key={environment}
                    label={environment}
                    isSelected={chosenEnvironments.includes(environment)}
                    onChange={(on: boolean) => {
                      setChosenEnvironments((current) => toggleOne(current, environment, on));
                    }}
                  />
                ))}
              </div>
            </FieldHelp>
          </fieldset>
        ) : (
          <p className="text-xs text-(--color-text-muted)" data-testid="qcms-group-no-environments">
            {t("membership.groups.noEnvironmentPicker")}
          </p>
        )}

        <div>
          <Button
            isDisabled={pending || incomplete}
            onPress={() => {
              run(() =>
                create(workspaceId, {
                  name: name.trim(),
                  roles,
                  environments: environmentSet,
                }),
              );
            }}
          >
            {t("membership.groups.createSubmit")}
          </Button>
        </div>
      </div>
    </section>
  );
}
