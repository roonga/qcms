"use client";

import { useState } from "react";

import { AccessPreview } from "@/components/access/access-preview";
import { FieldHelp } from "@/components/help-tip";
import { Alert, Button, Checkbox, TextField } from "@/components/kit";
import { t, type MessageKey } from "@/lib/i18n/en";
import {
  needsEnvironments,
  roleDescription,
  roleName,
  toggleOne,
  type GroupRole,
} from "@/lib/membership/access-group-form";
import {
  draftProblem,
  groupChange,
  groupPayload,
  holdsForApproval,
  type DraftProblem,
  type GroupDraft,
  type GroupPayload,
} from "@/lib/membership/group-edit";
import type { AccessGroup } from "@/lib/membership/types";

const FORM_ROLES: readonly GroupRole[] = ["forms.viewer", "forms.editor", "forms.publisher"];
const RESPONSE_ROLES: readonly GroupRole[] = ["responses.viewer", "responses.eraser"];

const PROBLEMS: Readonly<Record<DraftProblem, MessageKey>> = {
  name: "membership.groups.needsName",
  roles: "membership.groups.needsRole",
  environments: "membership.groups.needsEnvironment",
};

/** A group's name, roles and one environment set; the set is offered only where a role reads it. */
export function GroupForm({
  initial,
  before,
  environments,
  viewerInGroup,
  requireSecondApprover,
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  readonly initial: GroupDraft;
  /** The group as it stands, when this edits one. */
  readonly before?: AccessGroup | undefined;
  readonly environments: readonly string[];
  readonly viewerInGroup: boolean;
  readonly requireSecondApprover: boolean;
  readonly submitLabel: string;
  readonly pending: boolean;
  readonly error?: string | undefined;
  readonly onSubmit: (payload: GroupPayload) => void;
  readonly onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<GroupDraft>(initial);
  const [tried, setTried] = useState(false);

  const payload = groupPayload(draft, environments);
  const problem = draftProblem(payload);
  const wantsEnvironments = needsEnvironments(payload.roles);
  const held = holdsForApproval({
    requireSecondApprover,
    actorInGroup: viewerInGroup,
    before,
    after: payload,
  });

  function roleBox(role: GroupRole) {
    const description = roleDescription(role);
    return (
      <FieldHelp key={role} help={description} label={roleName(role)}>
        <Checkbox
          label={roleName(role)}
          isSelected={draft.roles.includes(role)}
          isDisabled={pending}
          onChange={(on: boolean) => {
            setDraft((current) => ({ ...current, roles: toggleOne(current.roles, role, on) }));
          }}
        />
      </FieldHelp>
    );
  }

  return (
    <form
      className="flex min-w-0 flex-col gap-4"
      data-testid="qcms-group-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (problem === undefined) onSubmit(payload);
      }}
    >
      <TextField
        label={t("membership.groups.createName")}
        value={draft.name}
        isDisabled={pending}
        maxLength={120}
        isInvalid={tried && problem === "name"}
        errorMessage={t("membership.groups.needsName")}
        onChange={(name) => {
          setDraft((current) => ({ ...current, name }));
        }}
      />

      <fieldset className="flex min-w-0 flex-col gap-1 rounded-(--radius-card) border border-(--color-border) px-3 py-2">
        <legend className="px-1 text-sm font-medium">{t("membership.groups.formForms")}</legend>
        {FORM_ROLES.map(roleBox)}
      </fieldset>
      <fieldset className="flex min-w-0 flex-col gap-1 rounded-(--radius-card) border border-(--color-border) px-3 py-2">
        <legend className="px-1 text-sm font-medium">{t("membership.groups.formResponses")}</legend>
        {RESPONSE_ROLES.map(roleBox)}
      </fieldset>

      {wantsEnvironments ? (
        <fieldset className="flex min-w-0 flex-col gap-1" data-testid="qcms-group-environments">
          <legend className="text-sm font-medium">
            {t("membership.groups.createEnvironments")}
          </legend>
          <FieldHelp help={t("membership.groups.environmentsHelp")}>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {environments.map((environment) => (
                <Checkbox
                  key={environment}
                  label={environment}
                  isDisabled={pending}
                  isSelected={draft.environments.includes(environment)}
                  onChange={(on: boolean) => {
                    setDraft((current) => ({
                      ...current,
                      environments: toggleOne(current.environments, environment, on),
                    }));
                  }}
                />
              ))}
            </div>
          </FieldHelp>
        </fieldset>
      ) : (
        <p className="text-sm text-(--color-text-muted)" data-testid="qcms-group-no-environments">
          {t("membership.groups.noEnvironmentPicker")}
        </p>
      )}

      {tried && problem !== undefined && problem !== "name" && (
        <p role="alert" className="text-sm text-(--color-danger-fg)">
          {t(PROBLEMS[problem])}
        </p>
      )}

      {before !== undefined && problem === undefined && (
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm">
            {t("membership.groups.previewFor", { count: String(before.holders.length) })}
          </p>
          <AccessPreview
            delta={groupChange(before, payload, environments)}
            approval={held ? { reason: t("membership.groups.selfApproval") } : undefined}
          />
        </div>
      )}
      {held && (
        <p className="text-sm text-(--color-text-muted)">
          {t("membership.groups.selfApprovalNote")}
        </p>
      )}

      {error !== undefined && <Alert variant="error">{error}</Alert>}

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel !== undefined && (
          <Button variant="secondary" size="md" isDisabled={pending} onPress={onCancel}>
            {t("access.confirm.cancel")}
          </Button>
        )}
        <Button type="submit" size="md" isDisabled={pending}>
          {pending
            ? t("access.confirm.working")
            : held
              ? t("access.preview.requestApproval")
              : submitLabel}
        </Button>
      </div>
    </form>
  );
}
