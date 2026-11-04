"use client";

import { useState, useTransition } from "react";

import { Alert, Button, Select, TextField } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { HeadingMarker } from "@/components/agent/heading-marker";
import type { AccessGroupList, MembershipActionState } from "@/lib/membership/types";

/* Group names are labels, never authorization inputs or join keys; grants come from role, scope, and
   membership. */
export function AccessGroupsPanel({
  list,
  message,
  environments,
  roles,
  create,
  remove,
  grant,
  revoke,
}: {
  readonly list: AccessGroupList | undefined;
  readonly message: string | undefined;
  readonly environments: readonly string[];
  readonly roles: readonly string[];
  readonly create: (
    workspaceId: string,
    body: {
      readonly name: string;
      readonly role: string;
      readonly environments: readonly string[];
      readonly forms: readonly string[];
      readonly label?: string;
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
  const [role, setRole] = useState(roles[0] ?? "");
  const [scope, setScope] = useState("all");
  const [forms, setForms] = useState("all");
  const [label, setLabel] = useState("");
  const [holderEmail, setHolderEmail] = useState<Record<string, string>>({});

  const workspaceId = list?.workspaceId ?? "";

  function run(action: () => Promise<MembershipActionState>): void {
    startTransition(async () => {
      setState(await action());
    });
  }

  return (
    <section aria-labelledby="qcms-access-groups-heading" className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id="qcms-access-groups-heading" className="text-lg font-semibold text-(--color-text)">
          {t("membership.groups.heading")}
        </h2>
        <p className="text-sm text-(--color-text-muted)">{t("membership.groups.intro")}</p>
        <p className="text-xs text-(--color-text-muted)">{t("membership.groups.nameHelp")}</p>
        {list !== undefined && (
          <p className="text-xs text-(--color-text-muted)">{list.scopeNote}</p>
        )}
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
            {list.groups.map((group) => (
              <li key={group.teamId} className="flex min-w-0 flex-col gap-2 border-t pt-2">
                <p className="text-sm font-medium break-all text-(--color-text)">{group.name}</p>
                <p className="text-xs break-all text-(--color-text-muted)">
                  {t("membership.groups.derivedName", {
                    fullName: group.fullName,
                    directoryName: group.directoryName,
                  })}
                </p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs break-all text-(--color-text-muted)">
                  <dt>{t("membership.groups.columnRole")}</dt>
                  <dd>{group.role}</dd>
                  <dt>{t("membership.groups.columnEnvironments")}</dt>
                  <dd>{group.environments.join(", ")}</dd>
                  <dt>{t("membership.groups.columnForms")}</dt>
                  <dd>{group.forms.join(", ")}</dd>
                  <dt>{t("membership.groups.columnHolders")}</dt>
                  <dd>
                    {group.holders.length === 0
                      ? t("membership.groups.noHolders")
                      : String(group.holders.length)}
                  </dd>
                </dl>

                <div className="flex min-w-0 flex-wrap items-end gap-2">
                  <TextField
                    label={t("membership.groups.addHolderEmail")}
                    type="email"
                    value={holderEmail[group.teamId] ?? ""}
                    onChange={(value: string) => {
                      setHolderEmail((current) => ({ ...current, [group.teamId]: value }));
                    }}
                  />
                  <Button
                    isDisabled={pending}
                    onPress={() => {
                      run(() => grant(workspaceId, group.teamId, holderEmail[group.teamId] ?? ""));
                    }}
                  >
                    {t("membership.groups.addHolderSubmit")}
                  </Button>
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
                    {group.holders.map((holder) => (
                      <li key={holder.userId} className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="min-w-0 text-xs break-all text-(--color-text-muted)">
                          {holder.email}
                        </span>
                        {/* Keep holder identity in the accessible name without widening the visible Revoke control past the mobile
   viewport. */}
                        <Button
                          variant="secondary"
                          isDisabled={pending}
                          aria-label={t("membership.groups.removeHolderFor", {
                            email: holder.email,
                          })}
                          onPress={() => {
                            run(() => revoke(workspaceId, group.teamId, holder.userId));
                          }}
                        >
                          {t("membership.groups.removeHolder")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        ))}

      <div className="flex min-w-0 flex-col gap-2 border-t pt-4">
        <h3 className="text-sm font-semibold text-(--color-text)">
          {t("membership.groups.create")}
        </h3>
        <HeadingMarker
          control={[
            "membership.groupCreate",
            "membership.groupRemove",
            "membership.grant",
            "membership.revoke",
          ]}
          block
        >
          <TextField
            label={t("membership.groups.createName")}
            value={name}
            onChange={setName}
            isRequired
          />
        </HeadingMarker>
        <Select
          label={t("membership.groups.createRole")}
          value={role}
          onChange={setRole}
          items={roles.map((entry) => ({ label: entry, value: entry }))}
        />
        <TextField
          label={t("membership.groups.createEnvironments")}
          value={scope}
          onChange={setScope}
          description={environments.join(", ")}
          isRequired
        />
        <TextField
          label={t("membership.groups.createForms")}
          value={forms}
          onChange={setForms}
          isRequired
        />
        <TextField label={t("membership.groups.createLabel")} value={label} onChange={setLabel} />
        <div>
          <Button
            isDisabled={pending}
            onPress={() => {
              run(() =>
                create(workspaceId, {
                  name,
                  role,
                  environments: scope
                    .split("-")
                    .map((entry) => entry.trim())
                    .filter(Boolean),
                  forms: forms
                    .split("\n")
                    .map((entry) => entry.trim())
                    .filter(Boolean),
                  ...(label === "" ? {} : { label }),
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
