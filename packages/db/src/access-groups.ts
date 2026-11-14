/**
 * An access group carries a set of roles and one explicit environment set, in one
 * workspace (`docs/WORKSPACE_ACCESS.md` section 3). Its name is a label chosen by an
 * administrator: never parsed, never an input to a permission.
 */

/** The five roles an access group can carry. */
export const ACCESS_ROLES = [
  "forms.viewer",
  "forms.editor",
  "forms.publisher",
  "responses.viewer",
  "responses.eraser",
] as const;

/** One of {@link ACCESS_ROLES}. */
export type AccessRole = (typeof ACCESS_ROLES)[number];

/** Whether a string is one of the roles. */
export function isAccessRole(value: string): value is AccessRole {
  return (ACCESS_ROLES as readonly string[]).includes(value);
}

/** The roles whose acts apply only in the group's environments. */
export const ENVIRONMENT_ROLES: readonly AccessRole[] = [
  "forms.publisher",
  "responses.viewer",
  "responses.eraser",
];

/** The roles the self-grant rule governs. */
export const RESPONSES_ROLES: readonly AccessRole[] = ["responses.viewer", "responses.eraser"];

/** Whether a role is in the data family, so the self-grant rule reaches it. */
export function isResponsesRole(value: string): boolean {
  return (RESPONSES_ROLES as readonly string[]).includes(value);
}

/** Whether any of these roles is a response role. */
export function carriesResponsesRole(roles: readonly string[]): boolean {
  return roles.some(isResponsesRole);
}

/** Whether this set of roles has to name at least one environment. */
export function needsEnvironments(roles: readonly string[]): boolean {
  return roles.some((role) => (ENVIRONMENT_ROLES as readonly string[]).includes(role));
}

export const ACCESS_GROUP_NAME_MAX_LENGTH = 120;

/** A group cannot name the same role twice, so this is also the whole set. */
export const ACCESS_GROUPS_MAX_ROLES = ACCESS_ROLES.length;

/** Why this role set is refused, or `undefined` when it is acceptable. */
export function refuseAccessGroupRoles(roles: readonly string[]): string | undefined {
  if (roles.length === 0) return "an access group carries at least one role";
  const unknown = roles.filter((role) => !isAccessRole(role));
  if (unknown.length > 0) return `no such role: ${unknown.join(", ")}`;
  const duplicate = roles.find((role, index) => roles.indexOf(role) !== index);
  if (duplicate !== undefined) return `the role set names ${duplicate} twice`;
  return undefined;
}

/**
 * The environment set in the live set's order, duplicates dropped. An environment the live
 * set does not hold is left at the end: the caller refuses it separately, and dropping it
 * here would turn a refusal into a different grant.
 */
export function normaliseEnvironmentSet(
  environments: readonly string[],
  liveEnvironments: readonly string[],
): readonly string[] {
  const position = new Map(liveEnvironments.map((name, index) => [name, index]));
  const unknownFrom = liveEnvironments.length;
  return [...new Set(environments)].sort(
    (a, b) => (position.get(a) ?? unknownFrom) - (position.get(b) ?? unknownFrom),
  );
}

/**
 * Why this environment set is refused for these roles, or `undefined` when it is
 * acceptable. There is no "every environment" value and no implicit environment: a group
 * carrying Publish forms, View responses or Erase responses names its own, and a group
 * carrying only View forms or Edit forms names none.
 */
export function refuseEnvironmentSet(
  environments: readonly string[],
  roles: readonly string[],
  liveEnvironments: readonly string[],
): string | undefined {
  const unknown = environments.filter((name) => !liveEnvironments.includes(name));
  if (unknown.length > 0) return `no such environment: ${unknown.join(", ")}`;
  const duplicate = environments.find((name, index) => environments.indexOf(name) !== index);
  if (duplicate !== undefined) return `the environment set names ${duplicate} twice`;
  if (needsEnvironments(roles)) {
    if (environments.length === 0) {
      return (
        "a group carrying forms.publisher, responses.viewer or responses.eraser names at " +
        "least one environment, on every site"
      );
    }
    return undefined;
  }
  if (environments.length > 0) {
    return (
      "forms.viewer and forms.editor apply in every environment, so a group carrying only " +
      "those names no environment"
    );
  }
  return undefined;
}

/** Why this name is refused, or `undefined` when it is acceptable. */
export function refuseAccessGroupName(name: string): string | undefined {
  if (name.trim() !== name) return "an access-group name has no leading or trailing space";
  if (name === "") return "an access-group name cannot be empty";
  if (name.length > ACCESS_GROUP_NAME_MAX_LENGTH) {
    return `an access-group name is at most ${String(ACCESS_GROUP_NAME_MAX_LENGTH)} characters`;
  }
  return undefined;
}

/** One of the groups every new workspace is created with. */
export interface StarterGroup {
  readonly name: string;
  readonly roles: readonly AccessRole[];
  readonly environments: readonly string[];
}

const PRODUCTION = "prod";

/**
 * The four starter groups for a site with these environments (`docs/WORKSPACE_ACCESS.md`
 * section 4). On a site whose only environment is `prod`, Authors carries Edit forms only,
 * because a group carrying Publish forms or View responses must name an environment.
 */
export function starterGroups(liveEnvironments: readonly string[]): readonly StarterGroup[] {
  const nonProd = liveEnvironments.filter((name) => name !== PRODUCTION);
  const authors: StarterGroup =
    nonProd.length > 0
      ? {
          name: "Authors",
          roles: ["forms.editor", "forms.publisher", "responses.viewer"],
          environments: nonProd,
        }
      : { name: "Authors", roles: ["forms.editor"], environments: [] };
  return [
    authors,
    { name: "Publishers", roles: ["forms.publisher"], environments: [PRODUCTION] },
    { name: "Response viewers", roles: ["responses.viewer"], environments: [PRODUCTION] },
    { name: "Response erasers", roles: ["responses.eraser"], environments: [PRODUCTION] },
  ];
}

/** Derived, never stored. */
export function accessGroupFullName(workspaceSlug: string, storedName: string): string {
  return `${workspaceSlug}.${storedName}`;
}
