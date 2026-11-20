import { t, type MessageKey } from "../i18n/en.ts";
import { formatList } from "../i18n/format.ts";
import { needsEnvironments, roleName } from "../membership/access-group-form.ts";

export const WORKSPACE_NAME_MAX_LENGTH = 120;
export const WORKSPACE_SLUG_MAX_LENGTH = 48;
/** How many identifiers a create tries when the name's own one is taken. */
export const SLUG_ATTEMPTS = 5;

/**
 * The stored identifier a name gives: lowercase letters and digits joined by single hyphens.
 * A name with none of those still gets one, since the identifier is never shown as a name.
 */
export function workspaceSlugFrom(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, WORKSPACE_SLUG_MAX_LENGTH)
    .replace(/-+$/u, "");
  return base === "" ? "workspace" : base;
}

/** The identifiers a create tries in turn: the name's own, then numbered ones. */
export function slugCandidates(name: string): readonly string[] {
  const base = workspaceSlugFrom(name);
  const candidates = [base];
  for (let n = 2; n <= SLUG_ATTEMPTS; n += 1) {
    const suffix = `-${String(n)}`;
    const stem = base.slice(0, WORKSPACE_SLUG_MAX_LENGTH - suffix.length).replace(/-+$/u, "");
    candidates.push(`${stem}${suffix}`);
  }
  return candidates;
}

export interface StarterGroup {
  readonly name: string;
  readonly roles: readonly string[];
  readonly environments: readonly string[];
}

/** "Edit forms, Publish forms": a starter group's roles in words. */
export function starterRoles(group: StarterGroup, locale: string): string {
  return formatList(group.roles.map(roleName), locale);
}

/** A group that applies in no environment says so, as the prod-only Authors group does. */
export function starterEnvironments(group: StarterGroup, locale: string): string {
  if (group.environments.length === 0 || !needsEnvironments(group.roles)) {
    return t("site.workspaces.starter.noEnvironment");
  }
  return formatList(group.environments, locale);
}

export type CreateWorkspaceState =
  | { readonly status: "idle" }
  | {
      readonly status: "created";
      readonly workspaceId: string;
      readonly name: string;
      readonly groups: readonly StarterGroup[] | undefined;
    }
  | {
      readonly status: "error";
      readonly code: string;
      readonly message: string;
      readonly submitted: { readonly name: string; readonly firstAdministrator: string };
    };

export const IDLE_CREATE_WORKSPACE: CreateWorkspaceState = { status: "idle" };

const CREATE_ERRORS: Readonly<Record<string, MessageKey>> = {
  FIRST_ADMINISTRATOR_NOT_FOUND: "site.workspaces.error.noAccount",
  FIRST_ADMINISTRATOR_NOT_CLAIMED: "site.workspaces.error.notClaimed",
  WORKSPACE_SLUG_TAKEN: "site.workspaces.error.slugTaken",
  http_400: "site.workspaces.error.invalid",
  http_403: "site.accounts.error.forbidden",
};

export function createWorkspaceErrorMessage(code: string): string {
  return t(CREATE_ERRORS[code] ?? "site.accounts.error.other");
}
