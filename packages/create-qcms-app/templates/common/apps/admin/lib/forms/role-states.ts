import { formatList } from "../i18n/format.ts";
import { environmentLabel } from "../environment.ts";
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
  return (
    environment === undefined || environments.length === 0 || environments.includes(environment)
  );
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

/**
 * The starter group that carries a role in an environment in a new workspace, or undefined
 * where none does: Response erasers covers `prod` only.
 */
export function starterGroupFor(role: string, environment?: string): string | undefined {
  const key = starterGroupKey(role, environment);
  return key === undefined ? undefined : t(key);
}

function starterGroupKey(role: string, environment: string | undefined): MessageKey | undefined {
  if (role === ERASE_RESPONSES_ROLE) {
    return environment === PRODUCTION ? "forms.unavailable.group.responseErasers" : undefined;
  }
  if (role === EDIT_FORMS_ROLE || environment !== PRODUCTION) {
    return "forms.unavailable.group.authors";
  }
  if (role === VIEW_RESPONSES_ROLE) return "forms.unavailable.group.responseViewers";
  return "forms.unavailable.group.publishers";
}

function workspaceName(workspace: MyAccessWorkspace | undefined): string {
  return workspace?.name ?? t("forms.unavailable.thisWorkspace");
}

export interface FormsListStates {
  /** Set while the caller cannot create a form here: the New form control is disabled with it. */
  readonly createReason: string | undefined;
  readonly readOnly: (workspaceId: string) => boolean;
  readonly readOnlyReason: string;
  /** Set while the caller holds no form role in the workspace: the empty state names it. */
  readonly noAccessWorkspace: string | undefined;
  /** Every place the caller holds in the workspace is suspended. */
  readonly suspended: boolean;
}

export function formsListStates(
  access: MyAccess | undefined,
  workspaceId: string | undefined,
): FormsListStates {
  const authors = t("forms.unavailable.group.authors");
  const readOnlyReason = t("forms.unavailable.readOnly", { group: authors });
  if (access === undefined) {
    return {
      createReason: undefined,
      readOnly: () => false,
      readOnlyReason,
      noAccessWorkspace: undefined,
      suspended: false,
    };
  }
  const workspace = workspaceOf(access, workspaceId);
  const scoped = workspaceId !== undefined;
  const canCreate = scoped
    ? holdsRole(workspace, EDIT_FORMS_ROLE)
    : access.workspaces.some((entry) => holdsRole(entry, EDIT_FORMS_ROLE));
  const noFormRole =
    scoped && workspace !== undefined && !FORM_ROLES.some((role) => holdsRole(workspace, role));
  const suspended = scoped && suspendedOnly(workspace);
  return {
    createReason: canCreate
      ? undefined
      : t("forms.unavailable.create", {
          workspace: workspaceName(workspace),
          group: authors,
        }),
    readOnly: (formWorkspaceId) =>
      !holdsRole(workspaceOf(access, formWorkspaceId), EDIT_FORMS_ROLE),
    readOnlyReason,
    noAccessWorkspace: noFormRole ? workspace?.name : undefined,
    suspended,
  };
}

/** Why erasing is unavailable here, naming a starter group only where one carries it. */
export function eraseUnavailable(environment: string): string {
  const group = starterGroupFor(ERASE_RESPONSES_ROLE, environment);
  return group === undefined
    ? t("ops.erase.known.deniedNoGroup", { environment: environmentLabel(environment) })
    : t("ops.erase.known.denied", { environment: environmentLabel(environment), group });
}

/** A workspace where every place the caller holds is suspended: it grants nothing until re-confirmed. */
export function suspendedOnly(workspace: MyAccessWorkspace | undefined): boolean {
  return (
    workspace !== undefined &&
    (workspace.suspended ?? []).length > 0 &&
    workspace.grants.length === 0
  );
}

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
): { readonly heading: string; readonly body: string; readonly suspended: boolean } {
  const heading = t("ops.unavailable.responsesHeading", {
    environment: environmentLabel(environment),
  });
  const group =
    starterGroupFor(VIEW_RESPONSES_ROLE, environment) ?? t("forms.unavailable.group.authors");
  const workspace = access === undefined ? undefined : workspaceOf(access, workspaceId);
  const suspended = (workspace?.suspended ?? []).some(
    (grant) => grant.roles.includes(VIEW_RESPONSES_ROLE) && covers(grant.environments, environment),
  );
  if (suspended) {
    return {
      heading,
      body: t("ops.unavailable.responsesSuspended", { environment: environmentLabel(environment) }),
      suspended: true,
    };
  }
  const elsewhere = (workspace?.environments ?? []).filter(
    (name) => name !== environment && holdsRole(workspace, VIEW_RESPONSES_ROLE, name),
  );
  if (elsewhere.length === 0) {
    return {
      heading,
      body: t("ops.unavailable.responsesNone", {
        environment: environmentLabel(environment),
        group,
      }),
      suspended: false,
    };
  }
  return {
    heading,
    body: t("ops.unavailable.responsesElsewhere", {
      environments: formatList(elsewhere.map(environmentLabel), locale),
      environment: environmentLabel(environment),
      group,
    }),
    suspended: false,
  };
}
