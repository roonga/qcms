import { t, type MessageKey } from "../i18n/en.ts";

/** The roles an access group can carry. Workspace administrator is the member row's flag. */
export const GROUP_ROLES = [
  "forms.viewer",
  "forms.editor",
  "forms.publisher",
  "responses.viewer",
  "responses.eraser",
] as const;

export type GroupRole = (typeof GROUP_ROLES)[number];

/** The roles whose acts apply only in the group's environments. */
export const ENVIRONMENT_ROLES: readonly string[] = [
  "forms.publisher",
  "responses.viewer",
  "responses.eraser",
];

const ROLE_KEYS: Readonly<Record<string, { name: MessageKey; description: MessageKey }>> = {
  "forms.viewer": {
    name: "membership.role.formsViewer.name",
    description: "membership.role.formsViewer.description",
  },
  "forms.editor": {
    name: "membership.role.formsEditor.name",
    description: "membership.role.formsEditor.description",
  },
  "forms.publisher": {
    name: "membership.role.formsPublisher.name",
    description: "membership.role.formsPublisher.description",
  },
  "forms.owner": {
    name: "membership.role.formsOwner.name",
    description: "membership.role.formsOwner.description",
  },
  "responses.viewer": {
    name: "membership.role.responsesViewer.name",
    description: "membership.role.responsesViewer.description",
  },
  "responses.eraser": {
    name: "membership.role.responsesEraser.name",
    description: "membership.role.responsesEraser.description",
  },
};

/** A role's plain name; an unfamiliar wire value is shown as it arrived rather than hidden. */
export function roleName(role: string): string {
  const keys = ROLE_KEYS[role];
  return keys === undefined ? role : t(keys.name);
}

/** One line on what the role allows, or `undefined` for an unfamiliar wire value. */
export function roleDescription(role: string): string | undefined {
  const keys = ROLE_KEYS[role];
  return keys === undefined ? undefined : t(keys.description);
}

/** Whether this set of roles has to name at least one environment. */
export function needsEnvironments(roles: readonly string[]): boolean {
  return roles.some((role) => ENVIRONMENT_ROLES.includes(role));
}

export function toggleOne(
  chosen: readonly string[],
  value: string,
  on: boolean,
): readonly string[] {
  const without = chosen.filter((entry) => entry !== value);
  return on ? [...without, value] : without;
}

/** The wire set, ordered as `ordered` is, so two spellings of one set look the same. */
export function setOf(chosen: readonly string[], ordered: readonly string[]): readonly string[] {
  return ordered.filter((entry) => chosen.includes(entry));
}

export interface EnvironmentEntry {
  readonly name: string;
  readonly position: number;
}

/** Environment names in the installation's own order. */
export function orderedEnvironments(environments: readonly EnvironmentEntry[]): readonly string[] {
  return [...environments]
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((entry) => entry.name);
}

export interface GrantCandidate {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
}

/** Members who do not already hold this group, the only accounts a grant can name. */
export function grantCandidates(
  members: readonly GrantCandidate[],
  holders: readonly { readonly userId: string }[],
): readonly GrantCandidate[] {
  const holding = new Set(holders.map((holder) => holder.userId));
  return members.filter((member) => !holding.has(member.userId));
}

export interface ScopedRoles {
  readonly roles: readonly string[];
  readonly environments: readonly string[];
}

/** A group's roles and environments in plain words. */
export function groupScope(group: ScopedRoles): string {
  return t("membership.groups.scope", {
    roles: group.roles.map(roleName).join(", "),
    environments:
      group.environments.length === 0
        ? t("membership.groups.everyEnvironment")
        : group.environments.join(", "),
  });
}

/** Each group's roles and environments, by the name a member row carries. */
export function groupTitlesByName(
  groups: readonly (ScopedRoles & { readonly name: string })[],
): ReadonlyMap<string, string> {
  return new Map(groups.map((group) => [group.name, groupScope(group)]));
}
