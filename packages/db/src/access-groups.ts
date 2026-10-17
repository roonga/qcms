/**
 * Access-group names, and the four rules that keep a name from becoming the thing it
 * describes (ADR-41, Q37 with Q38 and Q42; task 069).
 *
 * # The grammar
 *
 * The **stored** name is `<environments>.<plane>.<role>[.<label>]`, dotted, unique within
 * its workspace. The role token is always exactly **two** segments, because every one of
 * Q38's six role names is, so a reader takes position 1 as the environments, positions 2
 * and 3 as the role, and anything after as the label: `prod.responses.viewer.claims` is
 * environments `prod`, role `responses.viewer`, label `claims`, and `all.forms.editor`
 * has no label.
 *
 * The **full name** `<workspace>.<team>` and the **directory name**
 * `qcms.<workspace>.<team>` are **derived and never stored**, so a workspace slug rename
 * changes display only. {@link accessGroupFullName} and {@link accessGroupDirectoryName}
 * are those derivations, and nothing writes their output to a column.
 *
 * The dot beat a slash because a `sAMAccountName` may not contain `/`; it cannot collide
 * with a slug either, which is lowercase letters, digits and hyphens.
 *
 * # The four rules
 *
 * 1. **The team's fields are authoritative.** Role and scope are read from the team row.
 *    A mismatch between the name and those fields is a **validation error on save, never
 *    a permission**: {@link accessGroupNameFor} is what a write path compares against,
 *    and it returns the name the fields imply rather than deciding anything.
 * 2. **Nothing parses a name to authorise.** {@link parseAccessGroupName} exists for the
 *    UI and for an operator reading a list, and **no authorisation path calls it**. If
 *    every name in the installation were wrong, no access would change.
 * 3. **The name is never the join key.** Task C3 maps a directory group to a team by the
 *    stored `externalGroupId`, which is a column and not a name.
 * 4. **Uniqueness within a workspace is the QCMS write path's**, because the plugin does
 *    not enforce it on team names. That check is `queries/grants.ts`'.
 *
 * # Q42's combined-set ordering, moved here from task 064
 *
 * The environments segment carries a set in **the order of the rows in
 * `control.environments`**, so `dev-test` is the one spelling and `test-dev` is never a
 * second grant. 064's command creates one environment at a time and never writes a set,
 * which is why the clause moved to this task: this is the write path that stores a name
 * carrying one. {@link normaliseEnvironmentScope} is the normalisation and
 * {@link refuseEnvironmentScope} is the refusal, and a caller does both - the write path
 * normalises what it stores and refuses a name whose own segment is out of order, so
 * neither a normalisation nobody can see nor a refusal nobody can satisfy.
 */

/** The six role names (Q38). Each is exactly two dot-separated segments. */
export const ACCESS_ROLES = [
  "forms.viewer",
  "forms.editor",
  "forms.approver",
  "forms.owner",
  "responses.viewer",
  "responses.eraser",
] as const;

/** One of Q38's six roles. */
export type AccessRole = (typeof ACCESS_ROLES)[number];

/**
 * The roles that live on a **team** (an access group).
 *
 * `forms.owner` is the one role that is on the `member` row rather than on a team (Q32),
 * so a team carrying it is one of the two non-team targets the write path and the plugin
 * before-hooks refuse.
 */
export const TEAM_ROLES = ACCESS_ROLES.filter((role) => role !== "forms.owner");

/** The data-family roles, the ones the self-grant rule governs (Q56). */
export const RESPONSES_ROLES = ACCESS_ROLES.filter((role) => role.startsWith("responses."));

/** Whether a string is one of the six. */
export function isAccessRole(value: string): value is AccessRole {
  return (ACCESS_ROLES as readonly string[]).includes(value);
}

/** Whether a role may be carried by a team (everything but `forms.owner`). */
export function isTeamRole(value: string): boolean {
  return (TEAM_ROLES as readonly string[]).includes(value);
}

/** Whether a role is in the data family, so Q56's self-grant rule reaches it. */
export function isResponsesRole(value: string): boolean {
  return (RESPONSES_ROLES as readonly string[]).includes(value);
}

/** The scope token meaning "every environment" or "every form". */
export const SCOPE_ALL = "all";

/** The product prefix a directory group name carries at task C3 (Q37). */
export const DIRECTORY_NAME_PREFIX = "qcms";

/**
 * A label: free text, but a label with a dot in it would make the grammar ambiguous
 * about where the role ends, and one with whitespace at either end would make two
 * names that read the same compare differently.
 */
export const ACCESS_GROUP_LABEL_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** The longest stored name, so a name is a thing a list can show. */
export const ACCESS_GROUP_NAME_MAX_LENGTH = 120;

/** What a stored name says, read back. Never consulted on an authorisation path. */
export interface ParsedAccessGroupName {
  /** The environments segment, split: `all`, or one or more environment names. */
  readonly environments: readonly string[];
  /** The role token, positions 2 and 3 joined. */
  readonly role: string;
  /** The label, or `undefined` when the name has none. */
  readonly label?: string;
}

/**
 * Read a stored name back, or `undefined` when it is not one.
 *
 * For the UI and for an operator reading a list. **Not for authorisation** (rule 2).
 */
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
 * `all` stays `all`; anything else is the scope sorted into the order of
 * `liveEnvironments`, which is the order of the rows in `control.environments`. An
 * environment the live set does not hold is left at the end in the order it arrived,
 * because the caller refuses it separately and a normalisation that silently dropped it
 * would turn a refusal into a different grant.
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
 * Why this environments segment is refused, or `undefined` when it is acceptable.
 *
 * Two refusals, and they are different failures. A segment naming an environment that
 * does not exist is a grant on nothing, so it is refused rather than normalised. A
 * segment whose members are out of the live set's order is refused **as well as**
 * normalised by the caller, which is Q42: `test-dev` never becomes a second spelling of
 * `dev-test`, and the one spelling is the one the environments table orders.
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

/** The fields a stored name has to be in step with (rule 1). */
export interface AccessGroupFields {
  readonly role: string;
  /** The environment scope: `[all]`, or one or more environment names. */
  readonly environments: readonly string[];
  /** Free-text label, or `undefined` for a group that has none. */
  readonly label?: string;
}

/**
 * The stored name the fields imply, in the live set's order.
 *
 * The write path compares a caller's name against this and refuses a mismatch, which is
 * what makes the name a label kept in step rather than a second copy of the grant. The
 * **form scope never appears**: a form list in a name would be a second copy of the
 * scope, stale the first time somebody added a form (Q37).
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
 * Why this name is refused for these fields, or `undefined` when it is in step.
 *
 * A **validation error on save, never a permission** (rule 1). The fields decide what the
 * group grants; this decides whether the label somebody typed describes them.
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

/** `hr.prod.responses.viewer` from `hr` and `prod.responses.viewer`. Derived, never stored. */
export function accessGroupFullName(workspaceSlug: string, storedName: string): string {
  return `${workspaceSlug}.${storedName}`;
}

/** `qcms.hr.prod.responses.viewer`. The task C3 directory name; derived, never stored. */
export function accessGroupDirectoryName(workspaceSlug: string, storedName: string): string {
  return `${DIRECTORY_NAME_PREFIX}.${accessGroupFullName(workspaceSlug, storedName)}`;
}

/**
 * The sentence the UI prints beside the scope chooser (Q37).
 *
 * Here rather than in the admin's catalogue because it is a statement about the
 * permissions matrix rather than a piece of interface copy: every production action
 * belongs to a `forms.approver`, so `all` on a `forms.editor` is `dev` and `test` in
 * effect. The admin renders it; this is where it is true.
 */
export const EDITOR_ALL_SCOPE_NOTE =
  "`all` on a forms.editor is dev and test in effect, because every production action belongs to a forms.approver.";
