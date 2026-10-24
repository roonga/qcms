/**
 * Access-group names: `<environments>.<plane>.<role>[.<label>]`, dotted, unique within a
 * workspace, with the role token always exactly two of those segments (ADR-41).
 *
 * A name is a label kept in step with the team's fields, never an input to a permission:
 * nothing here may be called on an authorisation path, so if every name in the
 * installation were wrong, no access would change.
 */

/** The role names. Each is exactly two dot-separated segments. */
export const ACCESS_ROLES = [
  "forms.viewer",
  "forms.editor",
  "forms.approver",
  "forms.owner",
  "responses.viewer",
  "responses.eraser",
] as const;

/** One of {@link ACCESS_ROLES}. */
export type AccessRole = (typeof ACCESS_ROLES)[number];

/**
 * The roles that live on a team. `forms.owner` is on the `member` row instead, so a team
 * carrying it is refused by the write path and the plugin before-hooks.
 */
export const TEAM_ROLES = ACCESS_ROLES.filter((role) => role !== "forms.owner");

/** The data-family roles, the ones the self-grant rule governs. */
export const RESPONSES_ROLES = ACCESS_ROLES.filter((role) => role.startsWith("responses."));

/** Whether a string is one of the roles. */
export function isAccessRole(value: string): value is AccessRole {
  return (ACCESS_ROLES as readonly string[]).includes(value);
}

/** Whether a role may be carried by a team (everything but `forms.owner`). */
export function isTeamRole(value: string): boolean {
  return (TEAM_ROLES as readonly string[]).includes(value);
}

/** Whether a role is in the data family, so the self-grant rule reaches it. */
export function isResponsesRole(value: string): boolean {
  return (RESPONSES_ROLES as readonly string[]).includes(value);
}

/** The scope token meaning "every environment" or "every form". */
export const SCOPE_ALL = "all";

/** The product prefix a directory group name carries. */
export const DIRECTORY_NAME_PREFIX = "qcms";

/**
 * No dot, which would make the grammar ambiguous about where the role ends, and no
 * surrounding whitespace, which would make two names that read the same compare
 * differently.
 */
export const ACCESS_GROUP_LABEL_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const ACCESS_GROUP_NAME_MAX_LENGTH = 120;

/** A stored name read back. Never consulted on an authorisation path. */
export interface ParsedAccessGroupName {
  /** `all`, or one or more environment names. */
  readonly environments: readonly string[];
  readonly role: string;
  readonly label?: string;
}

/** Reads a stored name back, or `undefined` when it is not one. Never for authorisation. */
export function parseAccessGroupName(name: string): ParsedAccessGroupName | undefined {
  const segments = name.split(".");
  if (segments.length < 3) return undefined;
  const [environments, plane, role, ...rest] = segments;
  if (environments === undefined || plane === undefined || role === undefined) return undefined;
  if (environments === "") return undefined;
  const roleToken = `${plane}.${role}`;
  if (!isAccessRole(roleToken)) return undefined;
  const label = rest.length === 0 ? undefined : rest.join(".");
  return {
    environments: environments.split("-"),
    role: roleToken,
    ...(label === undefined ? {} : { label }),
  };
}

/**
 * The environments segment for a scope, in the live set's order.
 *
 * `all` stays `all`; anything else is sorted into `liveEnvironments` order. An
 * environment the live set does not hold is left at the end: the caller refuses it
 * separately, and dropping it here would turn a refusal into a different grant.
 */
export function normaliseEnvironmentScope(
  scope: readonly string[],
  liveEnvironments: readonly string[],
): readonly string[] {
  if (scope.length === 1 && scope[0] === SCOPE_ALL) return [SCOPE_ALL];
  const position = new Map(liveEnvironments.map((name, index) => [name, index]));
  const unknownFrom = liveEnvironments.length;
  return [...new Set(scope)].sort(
    (a, b) => (position.get(a) ?? unknownFrom) - (position.get(b) ?? unknownFrom),
  );
}

/**
 * Why this environments segment is refused, or `undefined` when it is acceptable. An
 * unknown environment is a grant on nothing, and an out-of-order set is refused as well as
 * normalised, so `test-dev` never becomes a second spelling of `dev-test`.
 */
export function refuseEnvironmentScope(
  scope: readonly string[],
  liveEnvironments: readonly string[],
): string | undefined {
  if (scope.length === 0) return "an environment scope cannot be empty";
  if (scope.includes(SCOPE_ALL)) {
    if (scope.length > 1) {
      return `${SCOPE_ALL} is the whole set, so it cannot be combined with an environment name`;
    }
    return undefined;
  }
  const unknown = scope.filter((name) => !liveEnvironments.includes(name));
  if (unknown.length > 0) {
    return `no such environment: ${unknown.join(", ")}`;
  }
  const duplicates = scope.filter((name, index) => scope.indexOf(name) !== index);
  if (duplicates.length > 0) return `the environment scope names ${duplicates[0] ?? ""} twice`;
  const normalised = normaliseEnvironmentScope(scope, liveEnvironments);
  if (normalised.join("-") !== scope.join("-")) {
    return (
      `a combined environment set is written in the order of control.environments, so ` +
      `${scope.join("-")} is spelled ${normalised.join("-")}`
    );
  }
  return undefined;
}

/** The authoritative fields a stored name has to be in step with. */
export interface AccessGroupFields {
  readonly role: string;
  /** `[all]`, or one or more environment names. */
  readonly environments: readonly string[];
  readonly label?: string;
}

/**
 * The stored name these fields imply, which a write path compares a caller's name against.
 * The form scope never appears, since a form list in a name would go stale.
 */
export function accessGroupNameFor(
  fields: AccessGroupFields,
  liveEnvironments: readonly string[],
): string {
  const environments = normaliseEnvironmentScope(fields.environments, liveEnvironments).join("-");
  const label = fields.label === undefined || fields.label === "" ? "" : `.${fields.label}`;
  return `${environments}.${fields.role}${label}`;
}

/**
 * Why this name is refused for these fields, or `undefined` when it is in step. A
 * validation error on save, never a permission.
 */
export function refuseAccessGroupName(
  name: string,
  fields: AccessGroupFields,
  liveEnvironments: readonly string[],
): string | undefined {
  if (name.length > ACCESS_GROUP_NAME_MAX_LENGTH) {
    return `an access-group name is at most ${String(ACCESS_GROUP_NAME_MAX_LENGTH)} characters`;
  }
  if (fields.label !== undefined && !ACCESS_GROUP_LABEL_PATTERN.test(fields.label)) {
    return (
      `an access-group label must match ${ACCESS_GROUP_LABEL_PATTERN.source} - lowercase ` +
      "letters, digits and hyphens - so the dotted name stays readable back"
    );
  }
  const expected = accessGroupNameFor(fields, liveEnvironments);
  if (name !== expected) {
    return (
      `the access-group name is out of step with its fields: this group's role and scope ` +
      `are named ${expected}`
    );
  }
  return undefined;
}

/** Derived, never stored. */
export function accessGroupFullName(workspaceSlug: string, storedName: string): string {
  return `${workspaceSlug}.${storedName}`;
}

/** The directory group name; derived, never stored. */
export function accessGroupDirectoryName(workspaceSlug: string, storedName: string): string {
  return `${DIRECTORY_NAME_PREFIX}.${accessGroupFullName(workspaceSlug, storedName)}`;
}

/**
 * The sentence the UI prints beside the scope chooser. Here rather than in the admin's
 * catalogue because it states the permissions matrix rather than interface copy.
 */
export const EDITOR_ALL_SCOPE_NOTE =
  "`all` on a forms.editor is dev and test in effect, because every production action belongs to a forms.approver.";
