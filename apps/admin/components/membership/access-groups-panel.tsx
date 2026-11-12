"use client";

import { useState, useTransition } from "react";

import { FieldHelp, HelpTip } from "@/components/help-tip";
import { Alert, Button, Checkbox, Select, TextField } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { HeadingMarker } from "@/components/agent/heading-marker";
import {
  ALL,
  formOptions,
  GROUP_ROLES,
  grantCandidates,
  groupNameFor,
  groupTitle,
  isChosen,
  roleDescription,
  roleName,
  scopeLabel,
  scopeOf,
  toggleAll,
  toggleOne,
  type GrantCandidate,
  type NamedForm,
  type ScopeChoice,
} from "@/lib/membership/access-group-form";
import type { AccessGroupList, MembershipActionState } from "@/lib/membership/types";

/* Group names are labels, never authorization inputs or join keys; grants come from role, scope, and
   membership. */
export function AccessGroupsPanel({
  list,
  message,
  environments,
  forms,
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
  /** The workspace's forms this caller may read. */
  readonly forms: readonly NamedForm[];
  readonly members: readonly GrantCandidate[];
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
  const [role, setRole] = useState<string>(GROUP_ROLES[0]);
  const [envChoice, setEnvChoice] = useState<ScopeChoice>(ALL);
  const [formChoice, setFormChoice] = useState<ScopeChoice>(ALL);
  const [formSearch, setFormSearch] = useState("");
  const [label, setLabel] = useState("");
  const [holder, setHolder] = useState<Readonly<Record<string, string>>>({});

  const workspaceId = list?.workspaceId ?? "";
  const scope = scopeOf(envChoice, environments);
  const formScope = scopeOf(
    formChoice,
    forms.map((form) => form.formId),
  );
  const name = groupNameFor(role, scope, label);
  const formNames = new Map(forms.map((form) => [form.formId, form.name]));
  const shownForms = formOptions(forms, formSearch, formChoice);
  const description = roleDescription(role);

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
                  <p className="text-sm font-medium text-(--color-text)">{groupTitle(group)}</p>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs break-all text-(--color-text-muted)">
                    <dt>{t("membership.groups.columnRole")}</dt>
                    <dd>{roleName(group.role)}</dd>
                    <dt>{t("membership.groups.columnEnvironments")}</dt>
                    <dd>{scopeLabel(group.environments, "membership.groups.scopeAll")}</dd>
                    <dt>{t("membership.groups.columnForms")}</dt>
                    <dd>
                      {scopeLabel(
                        group.forms,
                        "membership.groups.scopeAll",
                        (formId) => formNames.get(formId) ?? formId,
                      )}
                    </dd>
                    <dt>{t("membership.groups.columnHolders")}</dt>
                    <dd>
                      {group.holders.length === 0
                        ? t("membership.groups.noHolders")
                        : String(group.holders.length)}
                    </dd>
                  </dl>
                  <details>
                    <summary className="text-xs text-(--color-text-muted)">
                      {t("membership.groups.advanced")}
                    </summary>
                    <ul className="flex flex-col gap-1 pt-1 text-xs break-all text-(--color-text-muted)">
                      <li>{t("membership.groups.storedName", { name: group.name })}</li>
                      <li>{t("membership.groups.derivedName", { fullName: group.fullName })}</li>
                      <li>
                        {t("membership.groups.directoryName", {
                          directoryName: group.directoryName,
                        })}
                      </li>
                    </ul>
                  </details>

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
          <Select
            label={t("membership.groups.createRole")}
            value={role}
            onChange={setRole}
            items={GROUP_ROLES.map((entry) => ({ label: roleName(entry), value: entry }))}
            {...(description === undefined ? {} : { description })}
          />
        </HeadingMarker>

        <fieldset className="flex min-w-0 flex-col gap-1">
          <legend className="text-sm font-medium text-(--color-text)">
            {t("membership.groups.createEnvironments")}
          </legend>
          <FieldHelp
            help={t("membership.groups.allEnvironmentsHelp")}
            label={t("membership.groups.allEnvironments")}
          >
            <Checkbox
              label={t("membership.groups.allEnvironments")}
              isSelected={envChoice.kind === "all"}
              onChange={(on: boolean) => {
                setEnvChoice((current) => toggleAll(current, on));
              }}
            />
          </FieldHelp>
          {environments.map((environment) => (
            <Checkbox
              key={environment}
              label={environment}
              isSelected={isChosen(envChoice, environment)}
              onChange={(on: boolean) => {
                setEnvChoice((current) => toggleOne(current, environment, on));
              }}
            />
          ))}
        </fieldset>

        <fieldset className="flex min-w-0 flex-col gap-1">
          <legend className="text-sm font-medium text-(--color-text)">
            {t("membership.groups.createForms")}
          </legend>
          <FieldHelp
            help={t("membership.groups.allFormsHelp")}
            label={t("membership.groups.allForms")}
          >
            <Checkbox
              label={t("membership.groups.allForms")}
              isSelected={formChoice.kind === "all"}
              onChange={(on: boolean) => {
                setFormChoice((current) => toggleAll(current, on));
              }}
            />
          </FieldHelp>
          <FieldHelp help={t("membership.groups.formsReadable")}>
            <TextField
              label={t("membership.groups.formSearch")}
              value={formSearch}
              onChange={setFormSearch}
            />
          </FieldHelp>
          {shownForms.length === 0 ? (
            <p className="text-xs text-(--color-text-muted)">{t("membership.groups.noForms")}</p>
          ) : (
            shownForms.map((form) => (
              <Checkbox
                key={form.formId}
                label={form.name}
                isSelected={isChosen(formChoice, form.formId)}
                onChange={(on: boolean) => {
                  setFormChoice((current) => toggleOne(current, form.formId, on));
                }}
              />
            ))
          )}
        </fieldset>

        <details>
          <summary className="text-sm text-(--color-text)">
            {t("membership.groups.advanced")}
          </summary>
          <div className="flex flex-col gap-2 pt-2">
            <TextField
              label={t("membership.groups.createLabel")}
              value={label}
              onChange={setLabel}
            />
            <p
              className="text-xs break-all text-(--color-text-muted)"
              data-testid="qcms-group-name"
            >
              {name === undefined
                ? t("membership.groups.createNameMissing")
                : t("membership.groups.createName", { name })}
            </p>
            <p className="text-xs text-(--color-text-muted)">{t("membership.groups.nameHelp")}</p>
            <p className="text-xs text-(--color-text-muted)">
              {t("membership.groups.directoryHelp")}
            </p>
          </div>
        </details>

        <div>
          <Button
            isDisabled={pending || name === undefined || formScope.length === 0}
            onPress={() => {
              if (name === undefined) return;
              const trimmed = label.trim();
              run(() =>
                create(workspaceId, {
                  name,
                  role,
                  environments: scope,
                  forms: formScope,
                  ...(trimmed === "" ? {} : { label: trimmed }),
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
