import { formatList } from "../i18n/format.ts";
import { t, type MessageKey } from "../i18n/en.ts";
import type { MyAccess, MyAccessWorkspace } from "../membership/types.ts";

import { EDIT_FORMS_ROLE } from "./build-access.ts";

export const VIEW_FORMS_ROLE = "forms.viewer";
export const PUBLISH_FORMS_ROLE = "forms.publisher";
export const VIEW_RESPONSES_ROLE = "responses.viewer";
export const ERASE_RESPONSES_ROLE = "responses.eraser";

const FORM_ROLES: readonly string[] = [VIEW_FORMS_ROLE, EDIT_FORMS_ROLE, PUBLISH_FORMS_ROLE];
const PRODUCTION = "prod";

/*
 * These decide only what the screen draws and which reason it gives. Every act is still
 * authorised by the API, and an unreadable access record draws no reason at all.
 */

function workspaceOf(
  access: MyAccess,
  workspaceId: string | undefined,
): MyAccessWorkspace | undefined {
  return access.workspaces.find((workspace) => workspace.workspaceId === workspaceId);
}

function covers(environments: readonly string[], environment: string | undefined): boolean {
  return environment === undefined || environments.length === 0 || environments.includes(environment);
}

/** Whether a role is held in the workspace, in the environment when one is named. */
export function holdsRole(
  workspace: MyAccessWorkspace | undefined,
  role: string,
  environment?: string,
): boolean {
  if (workspace === undefined || workspace.archived) return false;
  return workspace.grants.some(
    (grant) => grant.roles.includes(role) && covers(grant.environments, environment),
  );
}

/** The starter group that carries a role in an environment in a new workspace. */
export function starterGroupFor(role: string, environment?: string): string {
  const key: MessageKey =
    role === ERASE_RESPONSES_ROLE
      ? "forms.unavailable.group.responseErasers"
      : role === EDIT_FORMS_ROLE || environment !== PRODUCTION
        ? "forms.unavailable.group.authors"
        : role === VIEW_RESPONSES_ROLE
          ? "forms.unavailable.group.responseViewers"
          : "forms.unavailable.group.publishers";
  return t(key);
}

function workspaceName(workspace: MyAccessWorkspace | undefined): string {
  return workspace?.name ?? t("forms.unavailable.thisWorkspace");
}

export interface FormsListStates {
  /** Set while the caller cannot create a form here: the New form control is disabled with it. */
  readonly createReason: string | undefined;
  /** Whether a row's form is read only to the caller. */
  readonly readOnly: (workspaceId: string) => boolean;
  /** The list's reason for read-only rows, shown once above the table. */
  readonly readOnlyReason: string;
  /** Set while the caller holds no form role in the workspace: the empty state names it. */
  readonly noAccessWorkspace: string | undefined;
}

export function formsListStates(
  access: MyAccess | undefined,
  workspaceId: string | undefined,
): FormsListStates {
  const readOnlyReason = t("forms.unavailable.readOnly", {
    group: starterGroupFor(EDIT_FORMS_ROLE),
  });
  if (access === undefined) {
    return {
      createReason: undefined,
      readOnly: () => false,
      readOnlyReason,
      noAccessWorkspace: undefined,
    };
  }
  const workspace = workspaceOf(access, workspaceId);
  const scoped = workspaceId !== undefined;
  const canCreate = scoped
    ? holdsRole(workspace, EDIT_FORMS_ROLE)
    : access.workspaces.some((entry) => holdsRole(entry, EDIT_FORMS_ROLE));
  const noFormRole =
    scoped && workspace !== undefined && !FORM_ROLES.some((role) => holdsRole(workspace, role));
  return {
    createReason: canCreate
      ? undefined
      : t("forms.unavailable.create", {
          workspace: workspaceName(workspace),
          group: starterGroupFor(EDIT_FORMS_ROLE),
        }),
    readOnly: (formWorkspaceId) =>
      !holdsRole(workspaceOf(access, formWorkspaceId), EDIT_FORMS_ROLE),
    readOnlyReason,
    noAccessWorkspace: noFormRole ? workspace?.name : undefined,
  };
}

/** The edit screen's read-only notice for a caller without Edit forms. */
export function readOnlyNotice(access: MyAccess | undefined, workspaceId: string): string {
  const workspace = access === undefined ? undefined : workspaceOf(access, workspaceId);
  return t("forms.unavailable.readOnlyIn", { workspace: workspaceName(workspace) });
}

/** Why View responses is missing in this environment, naming where the caller does hold it. */
export function responsesUnavailable(
  access: MyAccess | undefined,
  workspaceId: string | undefined,
  environment: string,
  locale: string,
): { readonly heading: string; readonly body: string } {
  const heading = t("ops.unavailable.responsesHeading", { environment });
  const group = starterGroupFor(VIEW_RESPONSES_ROLE, environment);
  const workspace = access === undefined ? undefined : workspaceOf(access, workspaceId);
  const elsewhere = (workspace?.environments ?? []).filter(
    (name) => name !== environment && holdsRole(workspace, VIEW_RESPONSES_ROLE, name),
  );
  if (elsewhere.length === 0) {
    return { heading, body: t("ops.unavailable.responsesNone", { environment, group }) };
  }
  return {
    heading,
    body: t("ops.unavailable.responsesElsewhere", {
      environments: formatList(elsewhere, locale),
      environment,
      group,
    }),
  };
}
